// ---------------------------------------------------------------------------
// Streaming del asistente (SSE) con cancelación
//
// Mismo contrato/validaciones que `assistant_chat`, pero la respuesta viaja
// como Server-Sent Events y se emite por eventos de Tauri para que la UI la
// pinte en vivo y pueda detenerla. Si el endpoint no es SSE, la UI cae al
// comando no-streaming de siempre.
//
// El parser SSE, el registro de cancelación y los DTOs de eventos viven en
// `ai::assistant` (dominio); este archivo sólo hace el HTTP blocking y emite.
// ---------------------------------------------------------------------------

const STREAM_TIMEOUT: Duration = Duration::from_secs(120);

/// Detiene un streaming en curso. Devuelve `false` si ya terminó o el id no es
/// válido (la UI no necesita tratarlo como error).
#[tauri::command]
pub fn cancel_assistant_stream(stream_id: String) -> bool {
    let Some(stream_id) = clean_stream_id(&stream_id) else {
        return false;
    };
    if let Ok(map) = active_streams().lock() {
        if let Some(flag) = map.get(&stream_id) {
            flag.store(true, Ordering::SeqCst);
            return true;
        }
    }
    false
}

fn emit_stream_failed(app: &AppHandle, stream_id: &str, message: &str, retryable: bool) {
    let _ = app.emit(
        "assistant-stream-failed",
        StreamFailedEvent {
            stream_id: stream_id.to_owned(),
            message: message.to_owned(),
            retryable,
        },
    );
}

/// Trabajo de streaming: corre en un hilo propio porque la respuesta HTTP se
/// lee con `std::io::Read` (reqwest blocking, ya habilitado) sin sumar crates.
fn run_stream_worker(
    app: AppHandle,
    registration: StreamRegistration,
    base_url: String,
    model: String,
    messages: Vec<Value>,
    key: Option<String>,
) {
    let stream_id = registration.stream_id.clone();
    let cancel = registration.cancel_flag();
    if cancel.load(Ordering::SeqCst) {
        let _ = app.emit(
            "assistant-stream-cancelled",
            StreamCancelledEvent {
                stream_id: stream_id.clone(),
            },
        );
        return;
    }
    let client = match reqwest::blocking::Client::builder()
        .timeout(STREAM_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            emit_stream_failed(&app, &stream_id, "no se pudo preparar la conexión", false);
            return;
        }
    };
    for attempt in 1..=2u8 {
        let json_mode = attempt == 1;
        let body = stream_request_body(&model, &messages, json_mode);
        let mut call = client
            .post(chat_endpoint(&base_url))
            .json(&body)
            .header("Accept", "text/event-stream");
        if let Some(secret) = key.as_deref() {
            call = call.bearer_auth(secret);
        }
        let response = match call.send() {
            Ok(response) => response,
            Err(error) => {
                let message = if error.is_timeout() {
                    format!(
                        "el proveedor no respondió en {} segundos",
                        STREAM_TIMEOUT.as_secs()
                    )
                } else if error.is_connect() {
                    "no se pudo conectar con el proveedor; revisá que Ollama/servicio esté encendido"
                        .to_owned()
                } else {
                    "la conexión con el proveedor falló".to_owned()
                };
                emit_stream_failed(&app, &stream_id, &message, true);
                return;
            }
        };
        let status = response.status();
        if json_mode && retry_without_json_mode(status.as_u16()) {
            continue;
        }
        if !status.is_success() {
            emit_stream_failed(
                &app,
                &stream_id,
                &format!("el proveedor rechazó el mensaje (HTTP {})", status.as_u16()),
                false,
            );
            return;
        }
        let is_sse = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.contains("text/event-stream"))
            .unwrap_or(false);
        if !is_sse {
            // Algunos endpoints ignoran `stream:true`; la UI reintenta sin
            // streaming en vez de mostrar un error definitivo.
            emit_stream_failed(
                &app,
                &stream_id,
                "el proveedor no devolvió un stream SSE interpretable",
                true,
            );
            return;
        }
        let mut response = response;
        let outcome = consume_sse_stream(&mut response, &cancel, |delta| {
            let _ = app.emit(
                "assistant-stream-delta",
                StreamDeltaEvent {
                    stream_id: stream_id.clone(),
                    delta: delta.to_owned(),
                },
            );
        });
        match outcome {
            Ok((_content, true)) => {
                let _ = app.emit(
                    "assistant-stream-cancelled",
                    StreamCancelledEvent {
                        stream_id: stream_id.clone(),
                    },
                );
            }
            Ok((content, false)) => {
                let (reply, actions) = parse_reply_content(&content)
                    .unwrap_or_else(|| (clean_reply(&content), Vec::new()));
                let action = actions.first().cloned();
                let _ = app.emit(
                    "assistant-stream-completed",
                    StreamCompletedEvent {
                        stream_id: stream_id.clone(),
                        reply,
                        action,
                        actions,
                        provider_id: "openai-compatible".to_owned(),
                        model: model.clone(),
                        simulated: false,
                    },
                );
            }
            Err(message) => emit_stream_failed(&app, &stream_id, &message, false),
        }
        return;
    }
}

/// Streaming del asistente. Devuelve en cuanto el trabajo quedó encolado; los
/// deltas y el cierre llegan por los eventos `assistant-stream-*`. Mismas
/// validaciones que `assistant_chat`; el proveedor simulado completa al instante.
#[tauri::command]
pub async fn assistant_chat_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    request: AssistantStreamRequest,
) -> Result<(), ProjectError> {
    let Some(stream_id) = clean_stream_id(&request.stream_id) else {
        return Err(ProjectError::message(
            ProjectErrorCode::InvalidProject,
            "el identificador de streaming no es válido",
        ));
    };
    let messages = clean_messages(&request.messages)?;
    let settings = state.settings_snapshot()?;
    let provider = settings.provider.clone();
    if provider.kind == "mock" {
        let reply = mock_reply(&messages, &provider.model);
        let _ = app.emit(
            "assistant-stream-completed",
            StreamCompletedEvent {
                stream_id,
                reply: reply.reply,
                action: reply.action,
                actions: reply.actions,
                provider_id: reply.provider_id,
                model: reply.model,
                simulated: true,
            },
        );
        return Ok(());
    }
    if provider.base_url.is_empty() || provider.model.is_empty() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "configurá un proveedor en Ajustes o usá el simulador",
        ));
    }
    validate_provider_base_url(&provider.base_url)?;
    let local = is_local_endpoint(&provider.base_url);
    if !local && !request.approved_cost {
        return Err(ProjectError::message(
            ProjectErrorCode::CostNotApproved,
            "confirmá que esta llamada puede consumir cuota antes de enviar el mensaje",
        ));
    }
    let key = read_key();
    if !local && key.is_none() {
        return Err(ProjectError::message(
            ProjectErrorCode::ProviderUnavailable,
            "falta la clave del proveedor en el almacén de Windows",
        ));
    }
    let context = assistant_context(request.context.as_ref());
    let body_messages = assistant_body_messages(&context, &messages);
    let registration = StreamRegistration::new(&stream_id);
    let base_url = provider.base_url.clone();
    let model = provider.model.clone();
    std::thread::spawn(move || {
        run_stream_worker(app, registration, base_url, model, body_messages, key);
    });
    Ok(())
}
