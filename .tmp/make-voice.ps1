$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$out = 'D:\Users\ofici\QODER-WORK\editor-ia\.tmp\folder-film-test\voz-narracion.wav'
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Sabina Desktop')
$synth.Rate = 0
$synth.SetOutputToWaveFile($out)
$text = 'Bienvenidos a esta prueba automatica de Olyvia. Tres imagenes reales se combinan con esta voz para crear un video. Cada plano se corta en las pausas naturales de la narracion. El resultado se puede editar como cualquier otro proyecto.'
$synth.Speak($text)
$synth.Dispose()
$info = Get-Item $out
Write-Output ("WAV: " + $info.Length + " bytes")
