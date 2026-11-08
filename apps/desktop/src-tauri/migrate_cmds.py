import re, pathlib, sys

os_sep = '\\'
src = pathlib.Path(sys.argv[1])
root = src / 'commands'
skip = {'domains' + os_sep + 'integrations' + os_sep + 'mcp_server.rs',
        'domains/integrations/mcp_server.rs'}
files = [p for p in root.rglob('*.rs')
         if '.tests.' not in p.name
         and p.relative_to(root).as_posix() not in {'domains/integrations/mcp_server.rs'}]

subs = [
    (r'StdioProxyGenerator::new\(\s*Arc::new\(LocalProxyRuntime\),\s*Arc::new\(TauriProxyEvents::new\(app\)\),\s*Arc::new\(LocalProxyFiles\),?\s*\)', 'state.proxy_generator()'),
    (r'StdioRenderLauncher::new\(\s*Arc::new\(SharedRenderRuntime::new\(state\.render_jobs\.clone\(\)\)\),\s*Arc::new\(TauriRenderEvents::new\(app\.clone\(\)\)\),\s*Arc::new\(LocalRenderFiles\),\s*Arc::new\(SystemRenderVerifier\),?\s*\)', 'state.render_launcher()'),
    (r'StateProviderSettings::new\(&state\)', 'state.provider_settings()'),
    (r'StateMediaTools::new\(&state\)', 'state.media_tools()'),
    (r'StateProjectSession::new\(&state\)', 'state.project_session()'),
    (r'&KeyringProviderSecrets\b', '&state.provider_secrets()'),
    (r'KeyringProviderSecrets\.read_key\(\)', 'state.provider_secrets().read_key()'),
    (r'&ReqwestProviderChat\b', '&state.provider_chat()'),
    (r'&ReqwestProviderProbe\b', '&state.provider_probe()'),
    (r'&ReqwestMotionChat\b', '&state.motion_chat()'),
    (r'&ReqwestMediaMatchChat\b', '&state.media_match_chat()'),
    (r'SchtasksWatchdog::new\(\)', 'state.watchdog()'),
    (r'\bLocalProjectDocuments\b', 'state.project_documents()'),
    (r'\bNativeProjectAssetFiles\b', 'state.project_asset_files()'),
    (r'\bLocalProjectVersioning\b', 'state.project_versioning()'),
    (r'\bLocalProjectAssetRecovery\b', 'state.project_asset_recovery()'),
    (r'\bLocalProxyFiles\b', 'state.proxy_files()'),
    (r'\bLocalProxyRuntime\b', 'state.proxy_runtime()'),
    (r'\bLocalSubtitleFiles\b', 'state.subtitle_files()'),
    (r'LocalLocalizedSubtitleFiles::new\(\)', 'state.localized_subtitle_files()'),
    (r'\bLocalTimelineExportFiles\b', 'state.timeline_export_files()'),
    (r'\bLocalLosslessOutputs\b', 'state.lossless_outputs()'),
    (r'SharedRenderRuntime::new\(state\.render_jobs\.clone\(\)\)', 'state.render_runtime()'),
    (r'TauriRenderEvents::new\(app\.clone\(\)\)', 'state.render_events()'),
    (r'TauriRenderEvents::new\(app\)', 'state.render_events()'),
    (r'TauriRenderDialogs::new\(app\.clone\(\)\)', 'state.render_dialogs()'),
    (r'\bLocalRenderFiles\b', 'state.render_files()'),
    (r'\bSystemRenderEncoder\b', 'state.render_encoder()'),
    (r'\bSystemRenderVerifier\b', 'state.render_verifier()'),
    (r'\bLocalConversionFiles\b', 'state.conversion_files()'),
    (r'\bSystemConversionRunner\b', 'state.conversion_runner()'),
    (r'\bSystemConversionHardware\b', 'state.conversion_hardware()'),
    (r'Arc::new\(TauriConversionEvents \{ app \}\)', 'Arc::new(state.conversion_events())'),
    (r'LocalRenderQueueStore::local\(\)', 'state.render_queue_store()'),
    (r'\bLocalRenderQueueStore\b', 'state.render_queue_store()'),
    (r'mcp::config_dir_store\(&state\.config_dir\)', 'state.mcp_store()'),
    (r'mcp::keyring_env\(\)', 'state.mcp_env()'),
    (r'mcp::stdio_factory\(\)', 'state.mcp_factory()'),
]

changed = []
for p in files:
    text = p.read_text(encoding='utf-8')
    orig = text
    for pat, rep in subs:
        text = re.sub(pat, rep, text)
    lines = text.split('\n')
    out = []
    skip_block = False
    for line in lines:
        if line.lstrip().startswith('use crate::infrastructure::'):
            if '{' in line and '};' not in line:
                skip_block = True
            continue
        if skip_block:
            if '};' in line:
                skip_block = False
            continue
        out.append(line)
    text = '\n'.join(out)
    if text != orig:
        p.write_text(text, encoding='utf-8')
        changed.append(str(p.relative_to(src)))

print('\n'.join(changed))
print(f'--- {len(changed)} files changed')
