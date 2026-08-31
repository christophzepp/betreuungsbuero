# Betreuungsbüro auf dem Dockge-Server (Blanko-Start)

## 1. Stack auf den Server bringen
Das Archiv `betreuungsbuero-stack-*.tar.gz` auf den Debian-Server kopieren und in den
Dockge-Stack-Ordner entpacken (Pfad ggf. anpassen):

    sudo mkdir -p /opt/stacks/betreuungsbuero
    sudo tar -xzf betreuungsbuero-stack-*.tar.gz -C /opt/stacks/betreuungsbuero
    
Danach erscheint der Stack in Dockge; dort **Deploy** klicken (der erste Bau
kompiliert die nativen Module und dauert einige Minuten).

## 2. Erstlauf
Im Browser `http://<server-ip>:8935/` öffnen → die leere Installation führt nach
`/setup`. Dort Admin-Konto anlegen; der abgefragte Einrichtungs-Token steht als
`SETUP_TOKEN` in der `.env` (in Dockge unter „.env“ einsehbar). Der Weg schließt
sich danach dauerhaft von selbst.

## 3. Cloudflare
Im Tunnel als Ziel `http://localhost:8935` eintragen (cloudflared auf dem Host)
bzw. `http://betreuungsbuero:8935` (cloudflared als Container – dann in der
compose.yaml den auskommentierten `networks:`-Block aktivieren und beide Stacks
an dasselbe externe Netz hängen). WebSockets funktionieren über den Tunnel.

**Zwei Cloudflare-Grenzen, die diese Software wirklich trifft:**
- **Uploads sind auf 100 MB je Anfrage begrenzt.** Gesamtimport, Außendienst-
  Rückspielung und große Fallsicherungen können darüber liegen → solche Importe
  im Büro-LAN direkt über `http://<server-ip>:8935` ausführen.
- **Antworten, die lange rechnen, brechen nach ~100 s ab** (Fehler 524). Der
  Download der serverseitigen Gesamtsicherung baut erst ein großes ZIP → auch
  den übers LAN ziehen, nicht über die Tunnel-Adresse.

## 4. Probefälle einspeisen
Entweder in der Oberfläche (Datenadministration → Mehrfallimport mit den
Fall-JSON-Dateien) oder die fünf mitgelieferten Demofälle per Seeder:

    docker compose exec betreuungsbuero node server/tools/demo-faelle/seed.js

## 5. Direkt danach empfohlen
- **Recovery-Schlüssel** setzen (Adminbereich): erst damit entstehen die
  verschlüsselten Wiederherstellungs-Abbilder, und die Gesamtsicherung kann
  VOLLSTÄNDIG melden.
- **Sicherungszeitplan** einrichten (Datei-Explorer → Einstellungen → Sicherung &
  Synchronisation), Ziel z. B. eine eingehängte USB-/NAS-Platte – der Zielordner
  liegt absichtlich AUSSERHALB von `daten/runtime`.
- Der Ordner `daten/runtime` neben dieser Datei ist der gesamte Datenbestand –
  in jedes Host-Backup aufnehmen.
