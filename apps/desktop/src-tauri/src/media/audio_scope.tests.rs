use super::*;

    fn sine(freq: f32, rate: u32, seconds: f32, amp: f32) -> Vec<f32> {
        (0..(rate as f32 * seconds) as usize)
            .map(|i| amp * (2.0 * PI * freq * i as f32 / rate as f32).sin())
            .collect()
    }

    #[test]
    fn waveform_min_max_per_bucket() {
        let samples = vec![0.5f32, -0.5, 0.25, -0.25];
        let buckets = waveform_buckets(&samples, 2);
        assert_eq!(buckets[0], [-0.5, 0.5]);
        assert_eq!(buckets[1], [-0.25, 0.25]);
        assert!(waveform_buckets(&[], 4).iter().all(|b| *b == [0.0, 0.0]));
    }

    #[test]
    fn spectrum_peaks_at_the_sine_frequency() {
        let rate = 48_000u32;
        let samples = sine(1_000.0, rate, 0.25, 0.8);
        let data = analyze_pcm(&samples, rate);
        assert_eq!(data.spectrum.len(), SPECTRUM_BINS);
        // Bin más energético debe caer cerca de 1 kHz (eje 0..Nyquist).
        let max_bin = data
            .spectrum
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .map(|(i, _)| i)
            .unwrap();
        // Conversión: el espectro remuestrea 1025 bins FFT → 512; cada bin de
        // salida cubre ~2 bins fuente, cada uno de rate/FFT_SIZE Hz.
        let bin_hz = rate as f32 / FFT_SIZE as f32;
        let approx_hz = max_bin as f32 * (FFT_SIZE / 2 + 1) as f32 / SPECTRUM_BINS as f32 * bin_hz;
        assert!(
            (approx_hz - 1_000.0).abs() < 200.0,
            "pico en {approx_hz} Hz"
        );
        // Una seno de amplitud 0.8 no debería reportar 0 dBFS plano.
        assert!(data.spectrum.iter().any(|&db| db > -40.0));
    }

    #[test]
    fn spectrogram_dimensions_and_db_range() {
        let rate = 48_000u32;
        let samples = sine(440.0, rate, 0.2, 0.5);
        let data = analyze_pcm(&samples, rate);
        assert_eq!(data.spectrogram_rows, SPECTROGRAM_ROWS);
        assert!(data.spectrogram_cols <= SPECTROGRAM_MAX_COLS);
        assert_eq!(
            data.spectrogram.len(),
            data.spectrogram_cols * data.spectrogram_rows
        );
        assert!(data
            .spectrogram
            .iter()
            .all(|&db| (-120.0..=0.0).contains(&db)));
        assert!(data.duration_seconds > 0.19 && data.duration_seconds < 0.21);
    }

    #[test]
    fn silence_stays_at_noise_floor() {
        let data = analyze_pcm(&vec![0.0f32; 48_000], 48_000);
        assert!(data.spectrum.iter().all(|&db| db <= -119.0));
        assert!(data.waveform.iter().all(|b| *b == [0.0, 0.0]));
    }

    #[test]
    fn empty_input_does_not_panic() {
        let data = analyze_pcm(&[], 48_000);
        assert_eq!(data.waveform.len(), WAVEFORM_BUCKETS);
        assert_eq!(data.spectrogram_cols, 1);
    }

    #[test]
    fn scope_range_requires_both_ends() {
        assert_eq!(normalize_scope_range(None, None).unwrap(), None);
        assert!(normalize_scope_range(Some(1.0), None).is_err());
        assert!(normalize_scope_range(None, Some(2.0)).is_err());
    }

    #[test]
    fn scope_range_rejects_invalid_values() {
        assert!(normalize_scope_range(Some(-1.0), Some(2.0)).is_err());
        assert!(normalize_scope_range(Some(f64::NAN), Some(2.0)).is_err());
        assert!(normalize_scope_range(Some(0.0), Some(0.0)).is_err());
        assert!(normalize_scope_range(Some(0.0), Some(-3.0)).is_err());
        assert!(normalize_scope_range(Some(0.0), Some(f64::INFINITY)).is_err());
    }

    /// Microbenchmark (ignorado por defecto): mide `analyze_pcm` sobre PCM
    /// sintético representativo (dos senos + ruido determinista) para
    /// cuantificar el coste CPU-bound de los scopes. Correr con:
    /// `cargo test --release -p editor-ia-desktop --lib audio_scopes -- --ignored --nocapture`
    /// y repetir con `--profile release-nolto` para el A/B de LTO.
    #[test]
    #[ignore = "microbenchmark: correr con --ignored --nocapture"]
    fn bench_analyze_pcm_throughput() {
        let rate = TARGET_RATE;
        let seconds = 30.0f32;
        let n = (rate as f32 * seconds) as usize;
        // Ruido LCG + dos senos: contenido espectral variado como audio real.
        let samples: Vec<f32> = (0..n)
            .map(|i| {
                let t = i as f32 / rate as f32;
                let noise = ((i as u32)
                    .wrapping_mul(1_664_525)
                    .wrapping_add(1_013_904_223)
                    >> 8) as f32
                    / (1u32 << 24) as f32
                    - 0.5;
                0.3 * (2.0 * PI * 440.0 * t).sin()
                    + 0.15 * (2.0 * PI * 3_000.0 * t).sin()
                    + 0.05 * noise
            })
            .collect();
        let _ = analyze_pcm(&samples, rate); // warmup (asignaciones de ventanas)
        let started = std::time::Instant::now();
        let iters = 3;
        for _ in 0..iters {
            let _ = analyze_pcm(&samples, rate);
        }
        let elapsed = started.elapsed().as_secs_f64() / iters as f64;
        let audio_seconds = n as f64 / rate as f64;
        eprintln!(
            "bench analyze_pcm: {audio_seconds:.1}s de audio en {elapsed:.3}s wall              ({:.1}x tiempo real), {n} muestras",
            audio_seconds / elapsed
        );
    }

    #[test]
    fn scope_range_clamps_duration_to_the_decode_cap() {
        let range = normalize_scope_range(Some(10.5), Some(MAX_ANALYZE_SECONDS + 60.0))
            .unwrap()
            .unwrap();
        assert_eq!(range, (10.5, MAX_ANALYZE_SECONDS));
        let small = normalize_scope_range(Some(0.0), Some(4.25))
            .unwrap()
            .unwrap();
        assert_eq!(small, (0.0, 4.25));
    }
