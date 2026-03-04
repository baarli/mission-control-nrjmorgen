# Mission Control - Deploy til nrjmorgen.com/kloakontroll

## 📦 Innhold

Dette er en komplett deploy-pakke for Mission Control dashboard.

### Filer
- `index.html` - Frontend (120KB SPA)
- `manifest.json` - PWA manifest
- `api/backend-v2.py` - Backend API
- `api/requirements.txt` - Python avhengigheter
- `deploy-to-nrjmorgen.sh` - Automatisk deploy-script

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

### Metode 2: Manuell deploy

#### Steg 1: Kopier filer
```bash
# Lag målmappe
mkdir -p /var/www/nrjmorgen.com/kloakontroll/api

# Kopier frontend
cp index.html /var/www/nrjmorgen.com/kloakontroll/
cp manifest.json /var/www/nrjmorgen.com/kloakontroll/

# Kopier backend
cp api/backend-v2.py /var/www/nrjmorgen.com/kloakontroll/api/
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

#### Steg 4: Start API
```bash
# Lag systemd service
cat > /etc/systemd/system/mission-control-api.service << 'EOF'
[Unit]
Description=Mission Control API
After=network.target

[Service]
Type=simple
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
