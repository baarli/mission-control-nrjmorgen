#!/bin/bash
# Mission Control Deploy Script for nrjmorgen.com
# Dette scriptet setter opp Mission Control på /kloakontroll

set -e

echo "🚀 Mission Control Deploy til nrjmorgen.com/kloakontroll"
echo "=========================================================="

# Konfigurasjon
DEPLOY_DIR="/var/www/nrjmorgen.com/kloakontroll"
API_PORT=8081

if [ ! -r /etc/nrj-mission-control.env ]; then
    echo "Configure /etc/nrj-mission-control.env before deployment." >&2
    exit 1
fi

echo ""
echo "1. Lager deploy-mappe..."
mkdir -p $DEPLOY_DIR
mkdir -p $DEPLOY_DIR/api

echo "2. Kopierer frontend filer..."
cp /root/.openclaw/workspace/mission-control/public/index.html $DEPLOY_DIR/
cp /root/.openclaw/workspace/mission-control/public/manifest.json $DEPLOY_DIR/ 2>/dev/null || echo "{}" > $DEPLOY_DIR/manifest.json

echo "3. Kopierer API filer..."
cp /root/.openclaw/workspace/mission-control/api/backend-v2.py $DEPLOY_DIR/api/
cp /root/.openclaw/workspace/mission-control/api/supabase_config.py $DEPLOY_DIR/api/
cp /root/.openclaw/workspace/mission-control/api/requirements.txt $DEPLOY_DIR/api/

echo "4. Setter opp API service..."
cat > /etc/systemd/system/mission-control-api.service << 'EOF'
[Unit]
Description=Mission Control API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/nrjmorgen.com/kloakontroll/api
Environment="PATH=/usr/local/bin:/usr/bin"
Environment="SUPABASE_URL=https://kvniauxokdtmpvjtfnej.supabase.co"
EnvironmentFile=/etc/nrj-mission-control.env
Environment="TENANT_ID=a0000000-0000-0000-0000-000000000001"
ExecStart=/usr/bin/python3 backend-v2.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "5. Konfigurerer nginx..."
cat > /etc/nginx/sites-available/nrjmorgen-kloakontroll << 'EOF'
server {
    listen 80;
    server_name nrjmorgen.com;
    
    # Mission Control på /kloakontroll
    location /kloakontroll/ {
        alias /var/www/nrjmorgen.com/kloakontroll/;
        index index.html;
        try_files $uri $uri/ /kloakontroll/index.html;
        
        # Cache statiske filer
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
    
    # API proxy
    location /kloakontroll/api/ {
        proxy_pass http://localhost:8081/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Hovedside (eksisterende nrjmorgen.com)
    location / {
        proxy_pass http://localhost:3000/;  # eller hvor nrjmorgen.com kjører
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

echo "6. Aktiverer nginx config..."
ln -sf /etc/nginx/sites-available/nrjmorgen-kloakontroll /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo "7. Starter API service..."
systemctl daemon-reload
systemctl enable mission-control-api
systemctl start mission-control-api

echo ""
echo "✅ Mission Control deployet!"
echo "   URL: https://nrjmorgen.com/kloakontroll"
echo "   API: http://localhost:8081"
echo ""
echo "Passord: kloakontroll2026"
