# Secure PDF Distribution & Accessible Document Reader (Flask Version)

A world-class, premium, secure web-based PDF distribution and reading platform built entirely from scratch in Python/Flask. The application allows administrators to organize PDFs into folders, create recipients, and generate unique, high-entropy random access URLs. Recipients see only their assigned directories and files in an elite glassmorphic dark theme and read them inside a custom keyboard-accessible PDF.js reader.

---

## 🚀 Quick Start (Local Setup)

### Prerequisites
- Python 3.10 or higher
- Pip (Python Package Installer)

### 1. Initialize the Application
Set up your virtual environment and install the required dependencies:
```bash
# Create virtual environment
python -m venv .venv

# Activate virtual environment
# On Windows (PowerShell):
.venv\Scripts\Activate.ps1
# On Windows (CMD):
.venv\Scripts\activate.bat
# On Unix/macOS:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Initialize the Database
Run the database setup script to initialize the SQLite database, compile folders, and seed the default admin account:
```bash
python setup_db.py
```

### 3. Start the Flask Server
Launch the Flask development server:
```bash
python app.py
```

### 4. Log In to the Administration Console
1. Navigate to: **`http://localhost:8000/admin/login.php`** (or clean route: **`http://localhost:8000/admin/`**)
2. Use the credentials configured in the database or seed data:
   - **Username**: `admin`
   - **Password**: `nikhil` (or the temporary password if resetting)
3. You can manage recipients, upload PDFs, organize folders, and update permissions directly from the administrator panel.

---

## 📁 System Architecture & Directory Structure

```
bookpdf/
├── app.py                   # Main Flask application and REST API controller
├── setup_db.py              # Database DDL constructor and seed administrator script
├── requirements.txt         # Python project package dependencies
├── .env                     # Local environment settings (port, debug mode, keys)
├── README.md                # System documentation, checklists, and guides
├── database/
   ├── schema.sql           # SQLite schema layout
   └── db.sqlite            # Active SQLite database file
├── storage/
   └── pdfs/                # Secure private directory containing raw PDF files
├── templates/               # Jinja2 HTML templates
   ├── index.html           # User portal library browser
   ├── error_page.html      # Access Denied / Invalid token static view
   └── admin/
       ├── login.html       # Admin login and password reset layout
       └── index.html       # Primary admin dashboard layout
└── public/
    └── assets/              # Static files served at /assets/
        ├── css/
        │   └── style.css    # Premium glassmorphic dark theme
        └── js/
            ├── main.js      # User PDF.js zoom/page rendering and arrow listeners
            └── admin.js     # Admin asynchronous stats, tables, and progress uploads
```

---

## 🔒 Security Checklist & Principles Implemented

1. **Private Storage Protection**: Raw PDF uploads are stored in `storage/pdfs/` outside of the public webroot. They cannot be directly navigated to or enumerated.
2. **Server-Side Authorization**: The file streaming route `/document.php` intercepts all document requests, verifies that the user token is active, and matches user permission records before writing the file stream.
3. **Password Hashing**: Admin passwords are saved as secure bcrypt hashes using Python's `bcrypt` library.
4. **Brute Force Rate Limiting**: The login process queries the `audit_logs` table for failed attempts from the requester's IP within the last 15 minutes. If it exceeds 5 failed attempts, login is locked.
5. **CSRF Protection**: All state-changing admin actions (uploads, user creations, updates) require a cryptographically generated token transmitted via header or form post.
6. **SQL Injection Prevention**: Every SQL transaction is compiled using Python's SQLite prepared statements and bound variables.
7. **XSS Protection**: Jinja2 automatic HTML escaping neutralizes raw HTML characters during rendering. Custom formatting filters use safe, escaped properties.
8. **Session Cookie Hardening**: Admin sessions utilize `HttpOnly` and `SameSite=Strict` cookie attributes.

---

## ♿ Accessibility (WCAG) Checklist Included

- **Skip Navigation**: Keyboard users can press `Tab` immediately on load to click the hidden skip-link, jumping past navigation bars directly to main content wrappers.
- **Semantic Structure**: Proper utilization of `<header>`, `<main>`, `<aside>`, `<section>`, `<nav>`, and `<button>` elements instead of nested `<div>` wrappers.
- **Screen Reader Compatibility**: ARIA attributes (`aria-label`, `aria-live`, `aria-modal`, `role="dialog"`, `role="toolbar"`) are applied where appropriate.
- **Focus Indicators**: Focused inputs, links, and buttons feature high-contrast electric blue outline indicator rings.
- **No Keyboard Traps**: Custom components (like the PDF reader modal) can be seamlessly closed by hitting the `Escape` key, restoring focus back to the triggering file item.
- **Keyboard Navigation**: While reading a document, recipients can use the `ArrowLeft` and `ArrowRight` keys to navigate pages without using a mouse.

---

## 💾 Storage & Folder Permissions

When deploying to web servers (e.g. Linux environments):
- The `database/` directory and `database/db.sqlite` file must be readable and writable by the process owner running the Flask/WSGI app.
- The `storage/pdfs/` directory must have read and write permissions.
- Public assets inside `public/assets/` require read permissions.

---

## 🌐 Server Deployment Guidance

In production, run the Flask application using a WSGI server like **Gunicorn** or **uWSGI** behind an **Nginx** reverse proxy.

### Nginx Reverse Proxy Configuration
```nginx
server {
    listen 80;
    server_name example.com;

    # Serve static assets directly via Nginx for maximum speed
    location /assets/ {
        alias /var/www/bookpdf/public/assets/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    # Proxy all other routes to Gunicorn running on port 8000
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 📈 Scalability and Performance

- **Memory Efficiency**: PDFs are streamed block-by-block using an 8KB memory buffer rather than loading entire multi-megabyte files into server memory.
- **Database Optimization**: Key columns in the SQLite layout (`users.access_token`, `permissions.user_id`, `audit_logs.timestamp`) are indexed to speed up access authorization checks for concurrent requests.
- **Static Assets**: Framework libraries (like FontAwesome and PDF.js) are loaded from highly cacheable, optimized CDNs to reduce request load on the local web server.
