use serde_json::{json, Value};

pub fn profile(value: Value, generation: i64) -> Option<Value> {
    if value["version"].as_u64()? != 1 {
        return None;
    }
    let local = match value.get("local") {
        Some(workspace) => {
            let inbox = workspace["projects"]
                .as_array()?
                .iter()
                .find(|project| project["isInbox"].as_bool() == Some(true))?;
            Some(json!({ "id": inbox["id"].as_str()?, "workspace": workspace }))
        }
        None => None,
    };
    let current = value.get("server").into_iter();
    let previous = match value.get("previousServers") {
        Some(servers) => servers.as_array()?.as_slice(),
        None => &[],
    };
    let mut remotes = Vec::new();
    for (order, remote) in current.chain(previous).enumerate() {
        let origin = remote["origin"].as_str()?;
        let url = reqwest::Url::parse(origin).ok()?;
        let account = remote["user"]["id"].as_str()?;
        if url.scheme() != "https"
            || url.origin().ascii_serialization() != origin
            || account.is_empty()
        {
            return None;
        }
        let mut remote = remote.as_object()?.clone();
        remote.insert("id".into(), json!(format!("remote:{origin}:{account}")));
        remote.insert("order".into(), json!(order));
        remotes.push(Value::Object(remote));
    }
    let current_server_id = if value.get("server").is_some() {
        remotes.first()?.get("id")
    } else {
        None
    };
    let space_id = match value["active"].as_str()? {
        "local" => Some(local.as_ref()?.get("id")?),
        "server" => Some(current_server_id?),
        "none" => None,
        _ => return None,
    };
    Some(json!({
        "selection": {
            "generation": generation, "epoch": "", "spaceId": space_id,
            "currentServerId": current_server_id, "discoverSession": false
        },
        "local": local,
        "remotes": remotes,
    }))
}
