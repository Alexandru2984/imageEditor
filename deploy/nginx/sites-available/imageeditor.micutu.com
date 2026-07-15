server {
    listen 80;
    listen [::]:80;
    server_name imageeditor.micutu.com;
    server_tokens off;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        default_type "text/plain";
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name imageeditor.micutu.com;
    server_tokens off;

    root /var/www/imageeditor.micutu.com;
    index index.html;

    ssl_certificate /etc/letsencrypt/live/imageeditor.micutu.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/imageeditor.micutu.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    access_log /var/log/nginx/imageeditor.micutu.com.access.log;
    error_log /var/log/nginx/imageeditor.micutu.com.error.log;

    include snippets/imageeditor-block-dotfiles.conf;
    include snippets/imageeditor-headers.conf;

    location / {
        include snippets/imageeditor-headers.conf;
        add_header Cache-Control "no-cache, no-transform" always;
        limit_except GET HEAD { deny all; }
        try_files $uri $uri/ /index.html;
    }

    # Vite content-hashes every file under /assets/. Deploys retain old files
    # beyond this cache lifetime so existing tabs never request a deleted worker.
    location /assets/ {
        include snippets/imageeditor-headers.conf;
        add_header Cache-Control "public, max-age=2592000, immutable, no-transform" always;
        limit_except GET HEAD { deny all; }
        try_files $uri =404;
    }
}
