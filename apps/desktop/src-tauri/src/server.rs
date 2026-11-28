use std::{collections::HashMap, time::Duration};

use cookie::Cookie;
use reqwest::{
    header::{
        HeaderMap, HeaderValue, ACCEPT, CACHE_CONTROL, CONTENT_TYPE, COOKIE, ORIGIN, SET_COOKIE,
    },
    redirect::Policy,
    Client, Method, StatusCode, Url,
};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{async_runtime::JoinHandle, ipc::Channel, AppHandle, Manager, State};
use tokio::sync::Mutex;
use zeroize::Zeroizing;

use crate::workspace::WorkspaceStore;

const LOGIN_PATH: &str = "/api/v1/auth/login";
const LOGOUT_PATH: &str = "/api/v1/auth/logout";
const PASSWORD_PATH: &str = "/api/v1/auth/password";
const SESSION_PATH: &str = "/api/v1/auth/session";
const SYNC_PATH: &str = "/api/v1/desktop-sync";
const EVENTS_PATH: &str = "/api/v1/product-events";
const PROJECTS_PATH: &str = "/api/v1/projects/";
const SESSION_COOKIE: &str = "__Secure-feito.session_token";
const SESSION_VAULT_ERROR: &str = "Não foi possível acessar a sessão do Feito no cofre do sistema.";
const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;
const CONNECTION_ERROR: &str = "Não foi possível conectar ao servidor Feito por HTTPS.";
const RESPONSE_ERROR: &str = "O servidor não retornou uma resposta válida do Feito.";

pub struct ServerSessions {
    store: WorkspaceStore,
    state: Mutex<SessionState>,
    event_stream: Mutex<Option<(u32, JoinHandle<()>)>>,
}

#[derive(Default)]
struct SessionState {
    client: Option<Client>,
    cookies: HashMap<String, Option<HeaderValue>>,
}

impl ServerSessions {
    pub fn new(store: WorkspaceStore) -> Self {
        Self {
            store,
            state: Mutex::new(SessionState::default()),
            event_stream: Mutex::new(None),
        }
    }

    async fn update_cookie(
        &self,
        state: &mut SessionState,
        origin: String,
        value: Option<Zeroizing<Vec<u8>>>,
    ) -> Result<(), &'static str> {
        let header = match value.as_ref() {
            Some(value) => Some(cookie_header(value)?),
            None => None,
        };
        let store = self.store.clone();
        let credential_origin = origin.clone();
        // Disable a signed-out or expired cookie for this process even if the vault is unavailable.
        if value.is_none() {
            state.cookies.insert(origin.clone(), None);
        }
        tauri::async_runtime::spawn_blocking(move || {
            store
                .write_session(&credential_origin, value.as_ref().map(|value| &value[..]))
                .map_err(|_| SESSION_VAULT_ERROR)?;
            if let Some(service) = store.credential_service() {
                remove_legacy_session(service, &credential_origin);
            }
            Ok::<(), &'static str>(())
        })
        .await
        .map_err(|_| SESSION_VAULT_ERROR)??;
        state.cookies.insert(origin, header);
        Ok(())
    }

    async fn cookie(
        &self,
        state: &mut SessionState,
        origin: &str,
    ) -> Result<Option<HeaderValue>, &'static str> {
        if let Some(cookie) = state.cookies.get(origin) {
            return Ok(cookie.clone());
        }
        let store = self.store.clone();
        let credential_origin = origin.to_owned();
        let cookie = tauri::async_runtime::spawn_blocking(move || {
            match store
                .read_session(&credential_origin)
                .map_err(|_| SESSION_VAULT_ERROR)?
            {
                Some(secret) => cookie_header(&secret).map(Some),
                None => match store.credential_service() {
                    Some(service) => migrate_legacy_session(&store, service, &credential_origin),
                    None => Ok(None),
                },
            }
        })
        .await
        .map_err(|_| SESSION_VAULT_ERROR)??;
        state.cookies.insert(origin.to_owned(), cookie.clone());
        Ok(cookie)
    }
}

#[derive(Serialize)]
pub struct ServerResponse {
    status: u16,
    body: Option<Value>,
}

fn server_origin(input: &str) -> Result<Url, &'static str> {
    let origin_error = "Informe uma origem HTTPS, como https://feito.exemplo.com.";
    let authority = input
        .strip_prefix("https://")
        .ok_or(origin_error)?
        .trim_end_matches('/');
    if authority.is_empty()
        || authority.contains(['/', '\\', '?', '#', '@', '%'])
        || input.chars().any(|c| c.is_control() || c.is_whitespace())
        || input.len() > 2048
    {
        return Err(origin_error);
    }
    let url = Url::parse(input).map_err(|_| origin_error)?;
    if url.path() != "/" || url.host_str().is_none() {
        return Err(origin_error);
    }
    Ok(url)
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn is_project_share_route(route: &str) -> bool {
    route
        .strip_prefix(PROJECTS_PATH)
        .and_then(|path| path.strip_suffix("/share"))
        .is_some_and(is_uuid)
}

fn request_url(mut url: Url, method: &Method, path: &str) -> Result<Url, &'static str> {
    let (route, query) = match path.split_once('?') {
        Some((route, query)) => (route, Some(query)),
        None => (path, None),
    };
    let allowed = match route {
        LOGIN_PATH | LOGOUT_PATH | PASSWORD_PATH => method == Method::POST && query.is_none(),
        SESSION_PATH => method == Method::GET && query.is_none(),
        SYNC_PATH => method == Method::GET || (method == Method::POST && query.is_none()),
        _ => {
            query.is_none()
                && matches!(*method, Method::GET | Method::PUT | Method::DELETE)
                && is_project_share_route(route)
        }
    };
    if !allowed
        || path.len() > 2048
        || path.contains('#')
        || path.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err("A rota solicitada não está disponível no Feito desktop.");
    }
    url.set_path(route);
    url.set_query(query);
    Ok(url)
}

fn https_client() -> reqwest::ClientBuilder {
    Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
}

fn new_client() -> Result<Client, &'static str> {
    https_client()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| CONNECTION_ERROR)
}

/// Older versions kept each session in its own vault item, which made the system ask for access
/// once per item. The vault now only holds the key; sessions are stored with the workspace.
fn legacy_session_entry(service: &str, origin: &str) -> Result<keyring::Entry, &'static str> {
    keyring::Entry::new(service, &format!("session-v1:{origin}")).map_err(|_| SESSION_VAULT_ERROR)
}

fn remove_legacy_session(service: &str, origin: &str) {
    if let Ok(entry) = legacy_session_entry(service, origin) {
        // Best effort: a leftover item is never read once the session is stored with the workspace.
        let _ = entry.delete_credential();
    }
}

fn migrate_legacy_session(
    store: &WorkspaceStore,
    service: &str,
    origin: &str,
) -> Result<Option<HeaderValue>, &'static str> {
    let entry = legacy_session_entry(service, origin)?;
    let secret = match entry.get_secret() {
        Ok(secret) => Zeroizing::new(secret),
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(_) => return Err(SESSION_VAULT_ERROR),
    };
    let header = cookie_header(&secret)?;
    store
        .write_session(origin, Some(&secret))
        .map_err(|_| SESSION_VAULT_ERROR)?;
    let _ = entry.delete_credential();
    Ok(Some(header))
}

fn cookie_header(value: &[u8]) -> Result<HeaderValue, &'static str> {
    let valid = !value.is_empty()
        && value.len() <= 2048
        && value.iter().all(|byte| {
            matches!(
                byte,
                0x21 | 0x23..=0x2b | 0x2d..=0x3a | 0x3c..=0x5b | 0x5d..=0x7e
            )
        });
    if !valid {
        return Err(RESPONSE_ERROR);
    }
    let mut bytes = Zeroizing::new(format!("{SESSION_COOKIE}=").into_bytes());
    bytes.extend_from_slice(value);
    let mut header = HeaderValue::from_bytes(&bytes).map_err(|_| RESPONSE_ERROR)?;
    header.set_sensitive(true);
    Ok(header)
}

fn received_session(headers: &HeaderMap) -> Result<Zeroizing<Vec<u8>>, &'static str> {
    let cookie = headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|raw| Cookie::parse(raw.to_str().ok()?).ok())
        .find(|cookie| cookie.name() == SESSION_COOKIE)
        .ok_or(RESPONSE_ERROR)?;
    if cookie.secure() != Some(true)
        || cookie.http_only() != Some(true)
        || cookie.domain().is_some()
        || cookie.path() != Some("/")
    {
        return Err(RESPONSE_ERROR);
    }
    Ok(Zeroizing::new(cookie.value().as_bytes().to_vec()))
}

async fn read_response(mut response: reqwest::Response) -> Result<ServerResponse, &'static str> {
    let status = response.status();
    if status.is_redirection() && status != StatusCode::NOT_MODIFIED {
        return Err("O servidor Feito redirecionou a requisição. Confira o endereço informado.");
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("A resposta do servidor Feito excede o limite desta versão.");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| CONNECTION_ERROR)? {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err("A resposta do servidor Feito excede o limite desta versão.");
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = if bytes.is_empty() {
        None
    } else if let Ok(body) = serde_json::from_slice(&bytes) {
        Some(body)
    } else if status.is_success() {
        return Err(RESPONSE_ERROR);
    } else {
        // Reverse proxies may return HTML on errors. The bridge only forwards structured API data.
        None
    };
    Ok(ServerResponse {
        status: status.as_u16(),
        body,
    })
}

#[tauri::command]
pub async fn server_request(
    sessions: State<'_, ServerSessions>,
    origin: String,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<ServerResponse, String> {
    let url = server_origin(&origin)?;
    let origin = url.origin().ascii_serialization();
    let method =
        Method::from_bytes(method.as_bytes()).map_err(|_| "O método da requisição é inválido.")?;
    let url = request_url(url, &method, &path)?;
    if body.is_some() && (method == Method::GET || is_project_share_route(url.path())) {
        return Err("Esta requisição ao servidor Feito não aceita um corpo.".into());
    }

    let is_login = url.path() == LOGIN_PATH;
    let is_logout = url.path() == LOGOUT_PATH;
    let mut state = sessions.state.lock().await;
    let cookie = if is_login {
        None
    } else {
        sessions.cookie(&mut state, &origin).await?
    };
    if is_logout {
        sessions
            .update_cookie(&mut state, origin.clone(), None)
            .await?;
        if cookie.is_none() {
            return Ok(ServerResponse {
                status: StatusCode::NO_CONTENT.as_u16(),
                body: None,
            });
        }
    } else if !is_login && cookie.is_none() {
        return Ok(ServerResponse {
            status: StatusCode::UNAUTHORIZED.as_u16(),
            body: Some(json!({
                "error": {
                    "code": "UNAUTHENTICATED",
                    "message": "Entre de novo para sincronizar com este servidor."
                }
            })),
        });
    }

    let client = match &state.client {
        Some(client) => client.clone(),
        None => {
            let client = new_client()?;
            state.client = Some(client.clone());
            client
        }
    };
    let mut request = client
        .request(method, url.clone())
        .header(ORIGIN, &origin)
        .header(ACCEPT, "application/json")
        .header(CACHE_CONTROL, "no-store");
    if let Some(cookie) = cookie {
        request = request.header(COOKIE, cookie);
    }
    if let Some(body) = body {
        let bytes = serde_json::to_vec(&body).map_err(|_| "O corpo da requisição é inválido.")?;
        if bytes.len() > MAX_REQUEST_BYTES {
            return Err("A requisição excede o limite desta versão.".into());
        }
        request = request.header(CONTENT_TYPE, "application/json").body(bytes);
    }
    let response = request.send().await.map_err(|_| CONNECTION_ERROR)?;
    let status = response.status();
    let login_cookie = if is_login && status == StatusCode::OK {
        Some(received_session(response.headers())?)
    } else {
        None
    };
    let result = read_response(response).await?;
    if let Some(cookie) = login_cookie {
        sessions
            .update_cookie(&mut state, origin, Some(cookie))
            .await?;
    } else if !is_logout && !is_login && status == StatusCode::UNAUTHORIZED {
        let _ = sessions.update_cookie(&mut state, origin, None).await;
    }
    Ok(result)
}

fn public_project_url(origin: &str, token: &str) -> Result<Url, &'static str> {
    let mut url = server_origin(origin)?;
    if !is_uuid(token) {
        return Err("O link público do projeto é inválido.");
    }
    url.set_path(&format!("/compartilhado/{token}"));
    Ok(url)
}

#[tauri::command]
pub async fn open_public_project(origin: String, token: String) -> Result<(), String> {
    let url = public_project_url(&origin, &token)?;
    #[cfg(target_os = "macos")]
    let mut opener = std::process::Command::new("/usr/bin/open");
    #[cfg(target_os = "linux")]
    let mut opener = std::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut opener = {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("rundll32.exe");
        command
            .arg("url.dll,FileProtocolHandler")
            .creation_flags(0x08000000);
        command
    };

    tauri::async_runtime::spawn_blocking(move || {
        opener
            .arg(url.as_str())
            .status()
            .is_ok_and(|status| status.success())
    })
    .await
    .unwrap_or(false)
    .then_some(())
    .ok_or_else(|| "Não foi possível abrir a página pública no navegador.".into())
}

#[derive(Default)]
struct RevisionEvents {
    line: Vec<u8>,
    revision_event: bool,
    revision: Option<u32>,
}

impl RevisionEvents {
    fn read(
        &mut self,
        chunk: &[u8],
        mut notify: impl FnMut(u32) -> bool,
    ) -> Result<(), &'static str> {
        for &byte in chunk {
            if byte != b'\n' {
                if self.line.len() >= 256 {
                    return Err(RESPONSE_ERROR);
                }
                self.line.push(byte);
                continue;
            }
            let line = self.line.strip_suffix(b"\r").unwrap_or(&self.line);
            if line.is_empty() {
                if self.revision_event
                    && self
                        .revision
                        .take()
                        .is_some_and(|revision| !notify(revision))
                {
                    return Err(CONNECTION_ERROR);
                }
                self.revision_event = false;
                self.revision = None;
            } else if line.starts_with(b"event:") {
                self.revision_event = line == b"event: revision";
            } else if let Some(data) = line.strip_prefix(b"data: ") {
                self.revision = std::str::from_utf8(data)
                    .ok()
                    .and_then(|value| value.parse().ok());
            }
            self.line.clear();
        }
        Ok(())
    }
}

async fn stream_product_events(
    sessions: &ServerSessions,
    mut url: Url,
    channel: &Channel<Option<u32>>,
) -> Result<(), &'static str> {
    let origin = url.origin().ascii_serialization();
    let cookie = {
        let mut state = sessions.state.lock().await;
        sessions
            .cookie(&mut state, &origin)
            .await?
            .ok_or(CONNECTION_ERROR)?
    };
    url.set_path(EVENTS_PATH);
    let client = https_client()
        .read_timeout(Duration::from_secs(40))
        .build()
        .map_err(|_| CONNECTION_ERROR)?;
    let mut response = client
        .get(url)
        .header(ORIGIN, &origin)
        .header(ACCEPT, "text/event-stream")
        .header(CACHE_CONTROL, "no-store")
        .header(COOKIE, cookie)
        .send()
        .await
        .map_err(|_| CONNECTION_ERROR)?;
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok());
    if response.status() != StatusCode::OK
        || !content_type.is_some_and(|value| value.split(';').next() == Some("text/event-stream"))
    {
        return Err(RESPONSE_ERROR);
    }

    let mut events = RevisionEvents::default();
    while let Some(chunk) = response.chunk().await.map_err(|_| CONNECTION_ERROR)? {
        events.read(&chunk, |revision| channel.send(Some(revision)).is_ok())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn start_product_events(
    app: AppHandle,
    origin: String,
    channel: Channel<Option<u32>>,
) -> Result<u32, String> {
    let url = server_origin(&origin)?;
    let sessions = app.state::<ServerSessions>();
    let mut stream = sessions.event_stream.lock().await;
    if let Some((_, task)) = stream.take() {
        task.abort();
    }
    let id = channel.id();
    let app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let _ = stream_product_events(&app.state::<ServerSessions>(), url, &channel).await;
        let _ = channel.send(None);
    });
    *stream = Some((id, task));
    Ok(id)
}

#[tauri::command]
pub async fn stop_product_events(app: AppHandle, subscription: u32) {
    let sessions = app.state::<ServerSessions>();
    let mut stream = sessions.event_stream.lock().await;
    if stream.as_ref().is_some_and(|(id, _)| *id == subscription) {
        if let Some((_, task)) = stream.take() {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_sessions_reopen_and_sign_out_without_the_system_vault() {
        let dir = tempfile::tempdir().unwrap();
        let origin = "https://feito.example.com";
        let open_sessions = || ServerSessions::new(WorkspaceStore::new_dev(dir.path().into()));

        tauri::async_runtime::block_on(async {
            {
                let sessions = open_sessions();
                let mut state = sessions.state.lock().await;
                assert!(sessions.cookie(&mut state, origin).await.unwrap().is_none());
                sessions
                    .update_cookie(
                        &mut state,
                        origin.into(),
                        Some(Zeroizing::new(b"test-token".to_vec())),
                    )
                    .await
                    .unwrap();
            }
            {
                let sessions = open_sessions();
                let mut state = sessions.state.lock().await;
                assert_eq!(
                    sessions.cookie(&mut state, origin).await.unwrap(),
                    Some(cookie_header(b"test-token").unwrap())
                );
                sessions
                    .update_cookie(&mut state, origin.into(), None)
                    .await
                    .unwrap();
            }
            let sessions = open_sessions();
            let mut state = sessions.state.lock().await;
            assert!(sessions.cookie(&mut state, origin).await.unwrap().is_none());
        });
    }

    #[test]
    fn reads_revision_events_across_chunks_and_keeps_heartbeats_out_of_ipc() {
        let mut events = RevisionEvents::default();
        let mut revisions = Vec::new();
        for chunk in [
            &b"event: revis"[..],
            &b"ion\r\ndata: 1"[..],
            &b"23\r\n\r\n: keepalive\n\nevent: other\ndata: 456\n\n"[..],
            &b"event: revision\ndata: 124\n\n"[..],
        ] {
            events
                .read(chunk, |revision| {
                    revisions.push(revision);
                    true
                })
                .unwrap();
        }
        assert_eq!(revisions, vec![123, 124]);
        assert!(events.read(&[b'x'; 257], |_| true).is_err());
    }

    #[test]
    fn retains_only_the_secure_feito_session_cookie() {
        let mut headers = HeaderMap::new();
        headers.append(
            SET_COOKIE,
            HeaderValue::from_static("unsafe=other; Secure; HttpOnly; Path=/"),
        );
        assert!(received_session(&headers).is_err());
        headers.append(
            SET_COOKIE,
            HeaderValue::from_static("__Secure-feito.session_token=abc%2F.def; Max-Age=604800; Secure; HttpOnly; Path=/; SameSite=Lax"),
        );
        let secret = received_session(&headers).unwrap();
        let header = cookie_header(&secret).unwrap();
        assert_eq!(header, "__Secure-feito.session_token=abc%2F.def");
        assert!(header.is_sensitive());
        assert!(cookie_header(b"abc; injected=bad").is_err());

        let mut unsafe_header = HeaderMap::new();
        unsafe_header.insert(
            SET_COOKIE,
            HeaderValue::from_static("__Secure-feito.session_token=abc; HttpOnly; Path=/"),
        );
        assert!(received_session(&unsafe_header).is_err());
    }

    #[test]
    fn only_accepts_https_origins() {
        assert_eq!(
            server_origin("https://feito.example.com:8443/")
                .unwrap()
                .origin()
                .ascii_serialization(),
            "https://feito.example.com:8443"
        );
        for origin in [
            "http://feito.example.com",
            "https://user@feito.example.com",
            "https://@feito.example.com",
            "https://feito.example.com/?a=b",
            "https://feito.example.com/path/..",
            "https://feito.example.com/#",
            "https://feito.example.com\\",
        ] {
            assert!(server_origin(origin).is_err(), "{origin}");
        }
    }

    #[test]
    fn restricts_routes_methods_and_authority() {
        let origin = server_origin("https://feito.example.com").unwrap();
        let sync = request_url(
            origin.clone(),
            &Method::GET,
            "/api/v1/desktop-sync?cursor=42",
        )
        .unwrap();
        assert_eq!(
            sync.as_str(),
            "https://feito.example.com/api/v1/desktop-sync?cursor=42"
        );
        assert!(request_url(origin.clone(), &Method::POST, SYNC_PATH).is_ok());
        assert!(request_url(origin.clone(), &Method::POST, LOGIN_PATH).is_ok());
        for (method, path) in [
            (Method::POST, SESSION_PATH),
            (Method::GET, LOGIN_PATH),
            (Method::DELETE, SYNC_PATH),
            (Method::GET, "/api/v1/tasks"),
            (Method::GET, "//other.example.com/api/v1/desktop-sync"),
            (Method::GET, "/api/v1/desktop-sync/../export"),
            (Method::GET, "/api/v1/desktop-sync?cursor=1#other"),
        ] {
            assert!(
                request_url(origin.clone(), &method, path).is_err(),
                "{path}"
            );
        }
    }

    #[test]
    fn allows_only_the_project_share_methods_and_path() {
        let origin = server_origin("https://feito.example.com").unwrap();
        let path = "/api/v1/projects/4aa87f4d-8772-4020-9f71-f2abd870d560/share";
        for method in [Method::GET, Method::PUT, Method::DELETE] {
            let url = request_url(origin.clone(), &method, path).unwrap();
            assert_eq!(url.path(), path);
        }
        assert!(request_url(origin.clone(), &Method::POST, path).is_err());
        for path in [
            "/api/v1/projects/../share",
            "/api/v1/projects/%2e%2e/share",
            "/api/v1/projects/4aa87f4d-8772-4020-9f71-f2abd870d560",
            "/api/v1/projects/4aa87f4d-8772-4020-9f71-f2abd870d560/share?unexpected=1",
        ] {
            assert!(request_url(origin.clone(), &Method::GET, path).is_err());
        }
    }

    #[test]
    fn opens_only_public_project_urls_over_https() {
        let token = "4aa87f4d-8772-4020-9f71-f2abd870d560";
        assert_eq!(
            public_project_url("https://feito.example.com:8443", token)
                .unwrap()
                .as_str(),
            "https://feito.example.com:8443/compartilhado/4aa87f4d-8772-4020-9f71-f2abd870d560"
        );
        assert!(public_project_url("http://feito.example.com", token).is_err());
        assert!(public_project_url("https://feito.example.com", "../ajustes").is_err());
    }
}
