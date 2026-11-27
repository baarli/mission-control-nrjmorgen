# Mission Control - Deploy til nrjmorgen.com/kloakontroll

## 📦 Innhold

Dette er en komplett deploy-pakke for Mission Control dashboard.

### Filer
- `index.html` - Frontend (120KB SPA)
- `manifest.json` - PWA manifest
- `supabase-integration.js` - Dataintegrasjon for frontend
- `api/backend-v2.py` - Backend API
- `api/supabase_config.py` - Backendens Supabase-konfigurasjon
- `api/requirements.txt` - Python avhengigheter
- `deploy-to-nrjmorgen.sh` - Automatisk deploy-script

Opprett `/etc/nrj-mission-control.env` på serveren med eier `root` og rettigheter `0600`. Sett `SUPABASE_SECRET_KEY` der, eller `SUPABASE_SERVICE_ROLE_KEY` hvis miljøet fortsatt bruker JWT-nøkkel. Systemd leser filen når tjenesten starter. Verdiene må heller aldri ligge i frontend eller Git.

### Driftsstatus i frontend

Oversikten viser ubekreftet status for tjenester og planlagte jobber. Morgenrutinen er utilgjengelig i den statiske visningen. Driftsbevis krever at helseendepunktet svarer med forventet JSON og at jobbens status kommer fra jobbens eget kjøringssignal.

Dagens saker, podkasttall og episoder vises som ubekreftet i den statiske visningen.

Eksportpanelet tilbyr lokale nedlastinger i JSON-, CSV- og HTML-format. Kalenderdataene er eksempeldata. Eksporthistorikken teller forsøk på å starte en nedlasting i nettleseren.

Kjør statustestene lokalt med `node --test tests/operator-status.test.mjs`.

## 🚀 Deploy-metoder

### Metode 1: Automatisk deploy (Anbefalt)

På nrjmorgen.com serveren:

```bash
# 1. Kopier denne mappen til serveren
scp -r mission-control-deploy root@185.158.133.1:/tmp/

# 2. SSH inn og kjør deploy-script
ssh root@185.158.133.1
cd /tmp/mission-control-deploy
bash deploy-to-nrjmorgen.sh
```

Deployskriptet bruker filene i samme checkout som skriptet. Kjør
`bash deploy-to-nrjmorgen.sh --stage-only <lokal mappe>` for å kontrollere
filpakken lokalt uten å endre vertskonfigurasjon eller starte tjenester.
Kjør `node --test tests/deploy-staging.test.mjs` for å kontrollere kopieringen med testfiler.

### Metode 2: Manuell deploy

#### Steg 1: Kopier filer
```bash
# Lag målmappe
mkdir -p /var/www/nrjmorgen.com/kloakontroll/api

# Kopier frontend
cp index.html /var/www/nrjmorgen.com/kloakontroll/
cp manifest.json /var/www/nrjmorgen.com/kloakontroll/
cp supabase-integration.js /var/www/nrjmorgen.com/kloakontroll/

# Kopier backend
cp api/backend-v2.py /var/www/nrjmorgen.com/kloakontroll/api/
cp api/supabase_config.py /var/www/nrjmorgen.com/kloakontroll/api/
cp api/requirements.txt /var/www/nrjmorgen.com/kloakontroll/api/
```

#### Steg 2: Installer Python avhengigheter
```bash
cd /var/www/nrjmorgen.com/kloakontroll/api
pip3 install -r requirements.txt
```

#### Steg 3: Konfigurer Nginx

Legg til i `/etc/nginx/sites-available/nrjmorgen.com`:

```nginx
# Mission Control på /kloakontroll
location /kloakontroll/ {
    alias /var/www/nrjmorgen.com/kloakontroll/;
    index index.html;
    try_files $uri $uri/ =404;
}

# Mission Control API
location /kloakontroll/api/ {
    proxy_pass http://localhost:8081/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

V2 forventer at forespørsler kommer inn med prefikset `/api/`. Proxyen
ovenfor fjerner hele prefikset `/kloakontroll/api/`. Før videreruting til
v2-rutene aktiveres, må vertens tilgangskontroll for API-et være verifisert.

#### Steg 4: Start API
```bash
# Lag systemd service
cat > /etc/systemd/system/mission-control-api.service << 'EOF'
[Unit]
Description=Mission Control API
After=network.target

[Service]
Type=simple
EnvironmentFile=/etc/nrj-mission-control.env
WorkingDirectory=/var/www/nrjmorgen.com/kloakontroll/api
ExecStart=/usr/bin/python3 backend-v2.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Start service
systemctl daemon-reload
systemctl enable mission-control-api
systemctl start mission-control-api

# Reload nginx
nginx -t && systemctl reload nginx
```

## 🔐 Tilgang

- **URL**: https://nrjmorgen.com/kloakontroll
- **Passord**: ``

Deploy-scriptet skriver publiseringsadresse og status. Tilgangsdetaljer håndteres på verten.

## 📝 Viktig

- Frontend er en SPA (Single Page Application) med hash-routing
- Backend kjører på port 8081
- API-endepunkter:
  - GET `/api/status` - System status
  - GET `/api/saker` - Saksliste
  - GET `/api/nrj-stats` - NRJ statistikk
  - POST `/api/routine/morning` - Kjør morgenrutine

## 🔧 Feilsøking

### Sjekk at API kjører
```bash
curl http://localhost:8081/api/health
```

Ved vellykket lokal sjekk svarer v2 med JSON der `status` er `ok`.
Ukjente GET- og POST-ruter gir HTTP 404. Test rutingen uten en kjørende
tjeneste med `python3 -B -m unittest discover -s tests -p test_api_routing.py`.

### Sjekk nginx config
```bash
nginx -t
```

### Se logger
```bash
journalctl -u mission-control-api -f
```

## 📞 Support

Ved problemer, sjekk:
1. API kjører: `systemctl status mission-control-api`
2. Nginx config: `nginx -t`
3. Firewall: Port 8081 må være åpen for localhost
