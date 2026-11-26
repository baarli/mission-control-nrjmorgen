#!/bin/bash
# Mission Control Deploy Script for nrjmorgen.com
# Dette scriptet setter opp Mission Control på /kloakontroll

set -e

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

stage_checkout() {
    local destination="$1"
    local source_file
    local -a frontend_files=(
        "$SCRIPT_DIR/index.html"
        "$SCRIPT_DIR/manifest.json"
        "$SCRIPT_DIR/supabase-integration.js"
    )
    local -a api_files=(
        "$SCRIPT_DIR/api/backend-v2.py"
        "$SCRIPT_DIR/api/supabase_config.py"
        "$SCRIPT_DIR/api/requirements.txt"
    )

    for source_file in "${frontend_files[@]}" "${api_files[@]}"; do
        if [[ ! -f "$source_file" || ! -r "$source_file" ]]; then
            printf 'Missing or unreadable checkout file: %s\n' "$source_file" >&2
            return 1
        fi
    done

    mkdir -p -- "$destination/api"
    cp -- "${frontend_files[@]}" "$destination/"
    cp -- "${api_files[@]}" "$destination/api/"
}

if [[ "${1:-}" == "--stage-only" ]]; then
    if [[ $# -ne 2 || -z "$2" ]]; then
        echo "Usage: bash deploy-to-nrjmorgen.sh --stage-only DIRECTORY" >&2
        exit 2
    fi
    stage_checkout "$2"
    exit 0
fi

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
echo "1. Klargjør filer fra checkouten..."
stage_checkout "$DEPLOY_DIR"

echo "2. Setter opp API service..."
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

echo "3. Konfigurerer nginx..."
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

echo "4. Aktiverer nginx config..."
ln -sf /etc/nginx/sites-available/nrjmorgen-kloakontroll /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

echo "5. Starter API service..."
systemctl daemon-reload
systemctl enable mission-control-api
systemctl start mission-control-api

echo ""
echo "✅ Mission Control deployet!"
echo "   URL: https://nrjmorgen.com/kloakontroll"
echo "   API: http://localhost:8081"
echo ""
echo "Tilgang administreres på verten."
