# app.py - Unified Flask Application for Secure PDF Distribution
import os
import sys
import math
import sqlite3
import secrets
import re
import datetime
import bcrypt
from flask import Flask, request, session, redirect, url_for, render_template, jsonify, g, Response

# Environment Loader
def load_env():
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if '=' in line:
                    key, val = line.split('=', 1)
                    os.environ[key.strip()] = val.strip()

load_env()

app = Flask(__name__, static_folder='public/assets', static_url_path='/assets', template_folder='templates')

# Generate a persistent-ish session key or fall back to a stable default key
app.secret_key = os.environ.get('APP_KEY', 'nikdoc-portal-default-stable-secret-key-3b8c2d1e')

# Configure session cookies for security
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Strict',
)

# Custom Template Filters
@app.template_filter('h')
def escape_html(s):
    if s is None:
        return ""
    import html
    return html.escape(str(s))

@app.template_filter('addslashes')
def addslashes_filter(s):
    if not s:
        return ""
    return s.replace('\\', '\\\\').replace("'", "\\'").replace('"', '\\"')

@app.template_filter('format_bytes')
def format_bytes_filter(bytes_size):
    try:
        bytes_size = float(bytes_size)
    except (ValueError, TypeError):
        return "0 B"
    units = ['B', 'KB', 'MB', 'GB']
    bytes_size = max(bytes_size, 0.0)
    if bytes_size == 0:
        return "0 B"
    pow_val = int(math.floor(math.log(bytes_size) / math.log(1024)))
    pow_val = min(pow_val, len(units) - 1)
    bytes_size /= (1024 ** pow_val)
    return f"{round(bytes_size, 2)} {units[pow_val]}"

# Database Helper
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), 'database', 'db.sqlite'))
        db = g._database = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON;")
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

# Helper to log event to the audit trail
def log_audit(action, status='success', user_id=None, document_id=None):
    try:
        ip = request.remote_addr or 'unknown'
        ua = request.headers.get('User-Agent', 'unknown')
        db = get_db()
        db.execute("""
            INSERT INTO audit_logs (user_id, document_id, action, timestamp, ip_address, user_agent, status)
            VALUES (?, ?, ?, datetime('now'), ?, ?, ?)
        """, (user_id, document_id, action, ip, ua, status))
        db.commit()
    except Exception as e:
        app.logger.error(f"Audit log failed: {e}")

# Helper to generate secure random token
def generate_secure_token(length=16):
    return secrets.token_hex(length)

# Custom PDF Page Counter
def get_pdf_page_count(path):
    try:
        size = os.path.getsize(path)
        chunks = []
        if size < 200000:
            chunks.append((0, size))
        else:
            chunks.append((0, 100000))
            chunks.append((size - 100000, 100000))
            
        max_pages = 0
        with open(path, 'rb') as f:
            for offset, length in chunks:
                f.seek(offset)
                data = f.read(length)
                text = data.decode('latin-1')
                matches = re.findall(r'/Count\s+(\d+)', text)
                for count in matches:
                    val = int(count)
                    if val > max_pages:
                        max_pages = val
        return max_pages if max_pages > 0 else 1
    except Exception:
        return 1

# Check CSRF
def check_csrf():
    token = request.form.get('csrf_token') or request.headers.get('X-CSRF-Token')
    session_token = session.get('csrf_token')
    if not session_token or token != session_token:
        return False
    return True

# Ensure CSRF token is in session
@app.before_request
def ensure_csrf_token():
    if 'csrf_token' not in session:
        session['csrf_token'] = generate_secure_token(16)

# Inject CSRF token to templates
@app.context_processor
def inject_csrf():
    return {'csrf_token': session.get('csrf_token', '')}

# Context helpers
@app.context_processor
def utility_processor():
    return dict(format_bytes=format_bytes_filter)

# Prevent caching on all responses for security and real-time updates
@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, private'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


# ========================================================
# USER ROUTES
# ========================================================

@app.route('/')
@app.route('/index.html')
def index():
    token = request.args.get('token', '').strip()
    if not token:
        return redirect(url_for('admin_login'))
        
    db = get_db()
    # Validate Access Token
    user = db.execute("SELECT * FROM users WHERE access_token = ? LIMIT 1", (token,)).fetchone()
    
    if not user or user['status'] != 'active':
        log_audit('ACCESS_DENIED', 'denied', None, None)
        return render_template('error_page.html'), 403
        
    user_id = user['id']
    user_name = user['name']
    
    # Fetch User Permissions
    allowed_doc_rows = db.execute("SELECT document_id FROM permissions WHERE user_id = ? AND document_id IS NOT NULL", (user_id,)).fetchall()
    allowed_doc_ids = [r['document_id'] for r in allowed_doc_rows]
    
    allowed_folder_rows = db.execute("SELECT folder_id FROM permissions WHERE user_id = ? AND folder_id IS NOT NULL", (user_id,)).fetchall()
    allowed_folder_ids = [r['folder_id'] for r in allowed_folder_rows]
    
    # Log view activities
    log_audit('ACCESS_LINK_OPENED', 'success', user_id)
    log_audit('LIBRARY_VIEWED', 'success', user_id)
    
    # User Folder Browser
    active_folder_id = request.args.get('folder', None)
    if active_folder_id is not None and active_folder_id != '':
        try:
            active_folder_id = int(active_folder_id)
        except ValueError:
            active_folder_id = None
    else:
        active_folder_id = None
        
    # Validate active folder permission
    if active_folder_id is not None:
        folder_allowed = False
        curr = active_folder_id
        while curr is not None:
            if curr in allowed_folder_ids:
                folder_allowed = True
                break
            # Get parent
            parent = db.execute("SELECT parent_id FROM folders WHERE id = ?", (curr,)).fetchone()
            curr = parent['parent_id'] if parent else None
            
        # Or if the folder contains files the user has direct access to
        if not folder_allowed:
            check_direct = db.execute("""
                SELECT COUNT(*) FROM documents d
                JOIN permissions p ON d.id = p.document_id
                WHERE d.folder_id = ? AND p.user_id = ?
            """, (active_folder_id, user_id)).fetchone()[0]
            if check_direct > 0:
                folder_allowed = True
                
        if not folder_allowed:
            log_audit('ACCESS_DENIED', 'denied', user_id)
            return "You do not have access to this folder.", 403
            
    # Fetch folders and documents
    visible_folders = []
    visible_documents = []
    
    if active_folder_id is None:
        # Root View
        if allowed_folder_ids:
            placeholders = ",".join("?" for _ in allowed_folder_ids)
            visible_folders = db.execute(f"SELECT * FROM folders WHERE id IN ({placeholders}) ORDER BY name ASC", allowed_folder_ids).fetchall()
        if allowed_doc_ids:
            placeholders = ",".join("?" for _ in allowed_doc_ids)
            visible_documents = db.execute(f"SELECT * FROM documents WHERE id IN ({placeholders}) AND folder_id IS NULL ORDER BY original_name ASC", allowed_doc_ids).fetchall()
    else:
        # Subfolder View
        visible_folders = db.execute("SELECT * FROM folders WHERE parent_id = ? ORDER BY name ASC", (active_folder_id,)).fetchall()
        if active_folder_id in allowed_folder_ids:
            visible_documents = db.execute("SELECT * FROM documents WHERE folder_id = ? ORDER BY original_name ASC", (active_folder_id,)).fetchall()
        else:
            if allowed_doc_ids:
                placeholders = ",".join("?" for _ in allowed_doc_ids)
                params = [active_folder_id] + list(allowed_doc_ids)
                visible_documents = db.execute(f"SELECT * FROM documents WHERE folder_id = ? AND id IN ({placeholders}) ORDER BY original_name ASC", params).fetchall()
                
    # Breadcrumbs
    breadcrumbs = []
    curr = active_folder_id
    while curr is not None:
        folder = db.execute("SELECT id, name, parent_id FROM folders WHERE id = ?", (curr,)).fetchone()
        if folder:
            breadcrumbs.insert(0, {'id': folder['id'], 'name': folder['name']})
            curr = folder['parent_id']
        else:
            break
            
    return render_template('index.html', 
                           token=token, 
                           user_name=user_name,
                           visible_folders=visible_folders,
                           visible_documents=visible_documents,
                           breadcrumbs=breadcrumbs)

@app.route('/document')
def document_stream():
    token = request.args.get('token', '').strip()
    doc_id = request.args.get('id', 0)
    try:
        doc_id = int(doc_id)
    except ValueError:
        return "Invalid request parameters", 400
        
    download = request.args.get('download', '0') == '1'
    
    if not token or doc_id <= 0:
        return "Invalid request parameters", 400
        
    db = get_db()
    # 1. Verify token
    user = db.execute("SELECT * FROM users WHERE access_token = ? LIMIT 1", (token,)).fetchone()
    if not user or user['status'] != 'active':
        log_audit('ACCESS_DENIED', 'denied', None, doc_id)
        return "Access denied. Link is invalid or revoked.", 403
        
    user_id = user['id']
    
    # 2. Fetch Document
    doc = db.execute("SELECT * FROM documents WHERE id = ? LIMIT 1", (doc_id,)).fetchone()
    if not doc or doc['status'] != 'active':
        return "Document not found", 404
        
    # 3. Verify Permissions
    has_permission = False
    p_doc = db.execute("SELECT COUNT(*) FROM permissions WHERE user_id = ? AND document_id = ?", (user_id, doc_id)).fetchone()[0]
    if p_doc > 0:
        has_permission = True
        
    if not has_permission and doc['folder_id'] is not None:
        p_folder = db.execute("SELECT COUNT(*) FROM permissions WHERE user_id = ? AND folder_id = ?", (user_id, doc['folder_id'])).fetchone()[0]
        if p_folder > 0:
            has_permission = True
            
    if not has_permission:
        log_audit('ACCESS_DENIED', 'denied', user_id, doc_id)
        return "Access denied. You do not have permission to view this document.", 403
        
    # 4. Locate Physical File
    storage_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), 'storage', 'pdfs'))
    file_path = os.path.join(storage_dir, doc['storage_path'])
    if not os.path.exists(file_path):
        return "Document file missing from physical storage", 404
        
    # 5. Log access
    log_action = 'DOCUMENT_DOWNLOADED' if download else 'DOCUMENT_OPENED'
    log_audit(log_action, 'success', user_id, doc_id)
    
    # Update last access time
    try:
        db.execute("UPDATE users SET last_access_at = datetime('now') WHERE id = ?", (user_id,))
        db.commit()
    except Exception:
        pass
        
    # 6. Stream file in chunks
    file_size = os.path.getsize(file_path)
    
    def generate():
        with open(file_path, 'rb') as f:
            while True:
                chunk = f.read(8192)
                if not chunk:
                    break
                yield chunk
                
    disp = 'attachment' if download else 'inline'
    headers = {
        'Content-Type': 'application/pdf',
        'Content-Length': file_size,
        'Content-Disposition': f'{disp}; filename="{doc["original_name"]}"',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=0, must-revalidate',
        'Pragma': 'public'
    }
    
    return Response(generate(), headers=headers)

@app.route('/error_page.html')
def error_page():
    return render_template('error_page.html')


# ========================================================
# ADMIN ROUTES
# ========================================================

@app.route('/admin/login.html', methods=['GET', 'POST'])
def admin_login():
    # Redirect if already logged in
    if session.get('admin_logged_in') and 'require_password_change' not in session:
        return redirect(url_for('admin_index'))
        
    error = ''
    success_message = ''
    show_change_password = session.get('require_password_change', False)
    
    ip = request.remote_addr or 'unknown'
    db = get_db()
    
    # Rate Limiting Check
    try:
        failed_attempts = db.execute("""
            SELECT COUNT(*) FROM audit_logs 
            WHERE ip_address = ? AND action = 'LOGIN_FAILURE' 
            AND timestamp > datetime('now', '-15 minutes')
        """, (ip,)).fetchone()[0]
        if failed_attempts >= 5:
            error = 'Too many failed login attempts. Please try again after 15 minutes.'
    except Exception as e:
        app.logger.error(f"Rate limiting query error: {e}")
        
    if request.method == 'POST' and not error:
        # Verify CSRF
        if not check_csrf():
            error = 'Invalid security token. Please refresh and try again.'
        else:
            if show_change_password:
                # Password Reset logic
                new_password = request.form.get('new_password', '')
                confirm_password = request.form.get('confirm_password', '')
                
                if not new_password or len(new_password) < 5:
                    error = 'Password must be at least 5 characters long.'
                elif new_password != confirm_password:
                    error = 'Passwords do not match.'
                else:
                    try:
                        admin_id = session.get('pending_admin_id')
                        salt = bcrypt.gensalt()
                        new_hash = bcrypt.hashpw(new_password.encode('utf-8'), salt).decode('utf-8')
                        
                        db.execute("""
                            UPDATE admin_users 
                            SET password_hash = ?, password_changed = 1 
                            WHERE id = ?
                        """, (new_hash, admin_id))
                        db.commit()
                        
                        # Log in admin fully
                        session['admin_logged_in'] = True
                        session['admin_id'] = admin_id
                        session['admin_username'] = session.get('pending_admin_username')
                        
                        session.pop('require_password_change', None)
                        session.pop('pending_admin_id', None)
                        session.pop('pending_admin_username', None)
                        
                        log_audit('LOGIN_SUCCESS', 'success')
                        return redirect(url_for('admin_index'))
                    except Exception as e:
                        error = 'Failed to update password. Please try again.'
            else:
                # Standard login logic
                username = request.form.get('username', '').strip()
                password = request.form.get('password', '')
                
                if not username or not password:
                    error = 'Username and password are required.'
                else:
                    try:
                        admin = db.execute("SELECT * FROM admin_users WHERE username = ? LIMIT 1", (username,)).fetchone()
                        
                        # Verify using bcrypt (handles both php $2y$ and python $2b$)
                        if admin and bcrypt.checkpw(password.encode('utf-8'), admin['password_hash'].encode('utf-8')):
                            if admin['status'] != 'active':
                                error = 'Your admin account has been disabled.'
                                log_audit('LOGIN_FAILURE', 'account_disabled')
                            else:
                                if admin['password_changed'] == 0:
                                    session['require_password_change'] = True
                                    session['pending_admin_id'] = admin['id']
                                    session['pending_admin_username'] = admin['username']
                                    show_change_password = True
                                    success_message = 'Please change your temporary password to continue.'
                                else:
                                    session['admin_logged_in'] = True
                                    session['admin_id'] = admin['id']
                                    session['admin_username'] = admin['username']
                                    
                                    db.execute("UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?", (admin['id'],))
                                    db.commit()
                                    
                                    log_audit('LOGIN_SUCCESS', 'success')
                                    return redirect(url_for('admin_index'))
                        else:
                            error = 'Invalid username or password.'
                            log_audit('LOGIN_FAILURE', 'invalid_credentials')
                    except Exception as e:
                        error = 'An internal database error occurred.'
                        app.logger.error(f"Login database error: {e}")
                        
    return render_template('admin/login.html', 
                           error=error, 
                           success_message=success_message, 
                           show_change_password=show_change_password)

@app.route('/admin/logout')
def admin_logout():
    if session.get('admin_logged_in'):
        log_audit('LOGOUT', 'success')
    session.clear()
    return redirect(url_for('admin_login'))

@app.route('/admin/')
@app.route('/admin/index.html')
def admin_index():
    if not session.get('admin_logged_in') or session.get('require_password_change'):
        return redirect(url_for('admin_login'))
    username = session.get('admin_username', 'Admin')
    return render_template('admin/index.html', username=username)


# ========================================================
# ADMIN API ROUTE
# ========================================================

@app.route('/admin/api', methods=['GET', 'POST'])
def admin_api():
    # Authorization Check
    if not session.get('admin_logged_in'):
        return jsonify({'error': 'Unauthorized access'}), 401
        
    # CSRF Check for write actions
    if request.method == 'POST':
        if not check_csrf():
            return jsonify({'error': 'Security token verification failed (CSRF)'}), 403
            
    action = request.args.get('action', '')
    db = get_db()
    
    # ----------------------------------------------------
    # API ACTIONS
    # ----------------------------------------------------
    
    if action == 'stats':
        try:
            users_count = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            docs_count = db.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
            logins_count = db.execute("SELECT COUNT(*) FROM audit_logs WHERE action = 'LOGIN_SUCCESS'").fetchone()[0]
            opens_count = db.execute("SELECT COUNT(*) FROM audit_logs WHERE action = 'DOCUMENT_OPENED'").fetchone()[0]
            failed_count = db.execute("SELECT COUNT(*) FROM audit_logs WHERE status = 'denied' OR status = 'failure'").fetchone()[0]
            
            return jsonify({
                'total_users': int(users_count),
                'total_docs': int(docs_count),
                'total_logins': int(logins_count),
                'total_opens': int(opens_count),
                'failed_access': int(failed_count)
            })
        except Exception as e:
            return jsonify({'error': 'Database error loading stats'}), 500
            
    elif action == 'get_users':
        try:
            users = db.execute("SELECT * FROM users ORDER BY id DESC").fetchall()
            return jsonify([dict(u) for u in users])
        except Exception:
            return jsonify({'error': 'Failed to fetch users'}), 500
            
    elif action == 'create_user':
        name = request.form.get('name', '').strip()
        email = request.form.get('email', '').strip()
        
        if not name or not email:
            return jsonify({'error': 'Name and email are required'}), 400
            
        # Email format validation
        if not re.match(r'[^@]+@[^@]+\.[^@]+', email):
            return jsonify({'error': 'Invalid email address format'}), 400
            
        try:
            token = generate_secure_token(16)
            cursor = db.cursor()
            cursor.execute("""
                INSERT INTO users (name, email, access_token, status)
                VALUES (?, ?, ?, 'active')
            """, (name, email, token))
            user_id = cursor.lastrowid
            db.commit()
            
            log_audit('USER_CREATED', 'success', user_id)
            return jsonify({'message': 'User created successfully', 'token': token})
        except Exception as e:
            return jsonify({'error': 'Email already registered or DB error'}), 500
            
    elif action == 'toggle_user':
        try:
            user_id = int(request.form.get('id', 0))
        except ValueError:
            user_id = 0
            
        status = request.form.get('status', '')
        
        if user_id <= 0 or status not in ['active', 'disabled']:
            return jsonify({'error': 'Invalid data parameters'}), 400
            
        try:
            db.execute("UPDATE users SET status = ? WHERE id = ?", (status, user_id))
            db.commit()
            
            if status == 'disabled':
                log_audit('TOKEN_REVOKED', 'success', user_id)
            return jsonify({'message': 'User status updated successfully'})
        except Exception:
            return jsonify({'error': 'Database error'}), 500
            
    elif action == 'delete_user':
        try:
            user_id = int(request.form.get('id', 0))
        except ValueError:
            user_id = 0
            
        if user_id <= 0:
            return jsonify({'error': 'Invalid user ID'}), 400
            
        try:
            db.execute("DELETE FROM permissions WHERE user_id = ?", (user_id,))
            db.execute("DELETE FROM users WHERE id = ?", (user_id,))
            db.commit()
            return jsonify({'message': 'User deleted successfully'})
        except Exception:
            return jsonify({'error': 'Database error deleting user'}), 500
            
    elif action == 'regenerate_token':
        try:
            user_id = int(request.form.get('id', 0))
        except ValueError:
            user_id = 0
            
        if user_id <= 0:
            return jsonify({'error': 'Invalid user ID'}), 400
            
        try:
            new_token = generate_secure_token(16)
            db.execute("UPDATE users SET access_token = ? WHERE id = ?", (new_token, user_id))
            db.commit()
            log_audit('TOKEN_REGENERATED', 'success', user_id)
            return jsonify({'message': 'Access token updated', 'token': new_token})
        except Exception:
            return jsonify({'error': 'Database error regenerating token'}), 500
            
    elif action == 'get_docs':
        folder_id = request.args.get('folder_id', None)
        if folder_id is not None and folder_id != '':
            try:
                folder_id = int(folder_id)
            except ValueError:
                folder_id = None
        else:
            folder_id = None
            
        try:
            # Subfolders
            if folder_id is None:
                folders = db.execute("SELECT * FROM folders WHERE parent_id IS NULL ORDER BY name ASC").fetchall()
                documents = db.execute("SELECT * FROM documents WHERE folder_id IS NULL ORDER BY original_name ASC").fetchall()
            else:
                folders = db.execute("SELECT * FROM folders WHERE parent_id = ? ORDER BY name ASC", (folder_id,)).fetchall()
                documents = db.execute("SELECT * FROM documents WHERE folder_id = ? ORDER BY original_name ASC", (folder_id,)).fetchall()
                
            # Breadcrumbs
            breadcrumbs = []
            curr = folder_id
            while curr is not None:
                folder = db.execute("SELECT id, name, parent_id FROM folders WHERE id = ?", (curr,)).fetchone()
                if folder:
                    breadcrumbs.insert(0, {'id': folder['id'], 'name': folder['name']})
                    curr = folder['parent_id']
                else:
                    break
                    
            return jsonify({
                'folders': [dict(f) for f in folders],
                'documents': [dict(d) for d in documents],
                'breadcrumbs': breadcrumbs
            })
        except Exception as e:
            return jsonify({'error': 'Failed to fetch directories'}), 500
            
    elif action == 'create_folder':
        name = request.form.get('name', '').strip()
        parent_id = request.form.get('parent_id', None)
        if parent_id is not None and parent_id != '':
            try:
                parent_id = int(parent_id)
            except ValueError:
                parent_id = None
        else:
            parent_id = None
            
        if not name:
            return jsonify({'error': 'Folder name is required'}), 400
            
        try:
            db.execute("INSERT INTO folders (name, parent_id) VALUES (?, ?)", (name, parent_id))
            db.commit()
            return jsonify({'message': 'Folder created successfully'})
        except Exception:
            return jsonify({'error': 'Database error creating folder'}), 500
            
    elif action == 'delete_folder':
        try:
            folder_id = int(request.form.get('id', 0))
        except ValueError:
            folder_id = 0
            
        if folder_id <= 0:
            return jsonify({'error': 'Invalid folder ID'}), 400
            
        try:
            # Check if empty
            files_count = db.execute("SELECT COUNT(*) FROM documents WHERE folder_id = ?", (folder_id,)).fetchone()[0]
            subs_count = db.execute("SELECT COUNT(*) FROM folders WHERE parent_id = ?", (folder_id,)).fetchone()[0]
            
            if files_count > 0 or subs_count > 0:
                return jsonify({'error': 'Cannot delete folder. It is not empty. delete files first.'}), 400
                
            db.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
            db.commit()
            return jsonify({'message': 'Folder deleted successfully'})
        except Exception:
            return jsonify({'error': 'Database error deleting folder'}), 500
            
    elif action == 'upload_file':
        log_audit('UPLOAD_STARTED', 'pending')
        
        if 'pdf_file' not in request.files:
            log_audit('UPLOAD_FAILED', 'no_file_uploaded')
            return jsonify({'error': 'File upload error. Check system post limits.'}), 400
            
        file = request.files['pdf_file']
        folder_id = request.form.get('folder_id', None)
        if folder_id is not None and folder_id != '':
            try:
                folder_id = int(folder_id)
            except ValueError:
                folder_id = None
        else:
            folder_id = None
            
        if file.filename == '':
            log_audit('UPLOAD_FAILED', 'empty_filename')
            return jsonify({'error': 'Empty filename uploaded'}), 400
            
        # Validate Extension and Mime type
        ext = os.path.splitext(file.filename)[1].lower()
        if ext != '.pdf':
            log_audit('UPLOAD_FAILED', 'invalid_extension')
            return jsonify({'error': 'Only PDF files are allowed'}), 400
            
        # Check size limit: 50MB max
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > 50 * 1024 * 1024:
            log_audit('UPLOAD_FAILED', 'file_too_large')
            return jsonify({'error': 'File size exceeds maximum limit of 50MB'}), 400
            
        # Read header to confirm PDF structure
        header = file.read(4)
        file.seek(0)
        if header != b'%PDF':
            log_audit('UPLOAD_FAILED', 'invalid_mime')
            return jsonify({'error': 'Invalid file content: Not a valid PDF'}), 400
            
        # Generate safe storage filename
        safe_name = generate_secure_token(16) + '.pdf'
        storage_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), 'storage', 'pdfs'))
        dest_path = os.path.join(storage_dir, safe_name)
        
        if not os.path.exists(storage_dir):
            os.makedirs(storage_dir, exist_ok=True)
            
        try:
            file.save(dest_path)
            
            # Calculate page count
            pages = get_pdf_page_count(dest_path)
            
            cursor = db.cursor()
            cursor.execute("""
                INSERT INTO documents (folder_id, original_name, storage_path, file_size, page_count, status)
                VALUES (?, ?, ?, ?, ?, 'active')
            """, (folder_id, file.filename, safe_name, file_size, pages))
            doc_id = cursor.lastrowid
            db.commit()
            
            log_audit('UPLOAD_COMPLETED', 'success', None, doc_id)
            return jsonify({'message': 'PDF uploaded and indexed successfully'})
        except Exception as e:
            if os.path.exists(dest_path):
                os.remove(dest_path)
            log_audit('UPLOAD_FAILED', 'database_insert_error')
            app.logger.error(f"Upload error: {e}")
            return jsonify({'error': 'Database error indexing file'}), 500
            
    elif action == 'delete_file':
        try:
            doc_id = int(request.form.get('id', 0))
        except ValueError:
            doc_id = 0
            
        if doc_id <= 0:
            return jsonify({'error': 'Invalid document ID'}), 400
            
        try:
            doc = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if not doc:
                return jsonify({'error': 'Document not found'}), 404
                
            storage_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), 'storage', 'pdfs'))
            dest_path = os.path.join(storage_dir, doc['storage_path'])
            
            # Log audit trail first to satisfy foreign key constraint before deleting doc
            log_audit('DOCUMENT_DELETED', 'success', None, doc_id)

            db.execute("DELETE FROM permissions WHERE document_id = ?", (doc_id,))
            db.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
            db.commit()
            
            # Delete physical file
            if os.path.exists(dest_path):
                try:
                    os.remove(dest_path)
                except Exception:
                    pass
                    
            return jsonify({'message': 'Document deleted successfully'})
        except Exception:
            return jsonify({'error': 'Failed to delete document from database'}), 500
            
    elif action == 'get_permissions':
        try:
            user_id = int(request.args.get('user_id', 0))
        except ValueError:
            user_id = 0
            
        if user_id <= 0:
            return jsonify({'error': 'Invalid user ID'}), 400
            
        try:
            perms = db.execute("SELECT * FROM permissions WHERE user_id = ?", (user_id,)).fetchall()
            doc_ids = [int(p['document_id']) for p in perms if p['document_id'] is not None]
            folder_ids = [int(p['folder_id']) for p in perms if p['folder_id'] is not None]
            
            all_docs = db.execute("SELECT id, original_name as name FROM documents ORDER BY original_name ASC").fetchall()
            all_folders = db.execute("SELECT id, name FROM folders ORDER BY name ASC").fetchall()
            
            return jsonify({
                'assigned_docs': doc_ids,
                'assigned_folders': folder_ids,
                'all_docs': [dict(d) for d in all_docs],
                'all_folders': [dict(f) for f in all_folders]
            })
        except Exception:
            return jsonify({'error': 'Database error loading user permissions'}), 500
            
    elif action == 'set_permission':
        try:
            user_id = int(request.form.get('user_id', 0))
            item_id = int(request.form.get('item_id', 0))
        except ValueError:
            return jsonify({'error': 'Invalid parameters'}), 400
            
        perm_type = request.form.get('type', '')
        
        if user_id <= 0 or item_id <= 0 or perm_type not in ['document', 'folder']:
            return jsonify({'error': 'Invalid parameters'}), 400
            
        try:
            doc_id = item_id if perm_type == 'document' else None
            folder_id = item_id if perm_type == 'folder' else None
            
            # Check if exists
            exists = db.execute("""
                SELECT COUNT(*) FROM permissions 
                WHERE user_id = ? AND (document_id = ? OR (document_id IS NULL AND ? IS NULL)) 
                AND (folder_id = ? OR (folder_id IS NULL AND ? IS NULL))
            """, (user_id, doc_id, doc_id, folder_id, folder_id)).fetchone()[0]
            
            if exists == 0:
                db.execute("INSERT INTO permissions (user_id, document_id, folder_id) VALUES (?, ?, ?)", (user_id, doc_id, folder_id))
                db.commit()
                
            return jsonify({'message': 'Permission assigned successfully'})
        except Exception:
            return jsonify({'error': 'Database error saving permissions'}), 500
            
    elif action == 'remove_permission':
        try:
            user_id = int(request.form.get('user_id', 0))
            item_id = int(request.form.get('item_id', 0))
        except ValueError:
            return jsonify({'error': 'Invalid parameters'}), 400
            
        perm_type = request.form.get('type', '')
        
        if user_id <= 0 or item_id <= 0 or perm_type not in ['document', 'folder']:
            return jsonify({'error': 'Invalid parameters'}), 400
            
        try:
            doc_id = item_id if perm_type == 'document' else None
            folder_id = item_id if perm_type == 'folder' else None
            
            db.execute("""
                DELETE FROM permissions 
                WHERE user_id = ? 
                AND (document_id = ? OR (document_id IS NULL AND ? IS NULL))
                AND (folder_id = ? OR (folder_id IS NULL AND ? IS NULL))
            """, (user_id, doc_id, doc_id, folder_id, folder_id))
            db.commit()
            
            return jsonify({'message': 'Permission removed successfully'})
        except Exception:
            return jsonify({'error': 'Database error removing permissions'}), 500
            
    elif action == 'get_logs':
        try:
            page = max(int(request.args.get('page', 1)), 1)
        except ValueError:
            page = 1
            
        limit = 20
        offset = (page - 1) * limit
        
        action_filter = request.args.get('action_filter', '').strip()
        status_filter = request.args.get('status_filter', '').strip()
        
        try:
            where_clauses = []
            params = []
            
            if action_filter:
                where_clauses.append("l.action = ?")
                params.append(action_filter)
                
            if status_filter:
                where_clauses.append("l.status = ?")
                params.append(status_filter)
                
            where_sql = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
            
            # Count total
            c_stmt = db.execute(f"SELECT COUNT(*) FROM audit_logs l {where_sql}", params)
            total_logs = c_stmt.fetchone()[0]
            total_pages = int(math.ceil(total_logs / limit))
            
            # Fetch list
            stmt_params = params + [limit, offset]
            data_query = f"""
                SELECT l.*, u.name as user_name, u.email as user_email, d.original_name as doc_name 
                FROM audit_logs l
                LEFT JOIN users u ON l.user_id = u.id
                LEFT JOIN documents d ON l.document_id = d.id
                {where_sql}
                ORDER BY l.id DESC
                LIMIT ? OFFSET ?
            """
            logs = db.execute(data_query, stmt_params).fetchall()
            
            # Get list of unique actions
            actions = db.execute("SELECT DISTINCT action FROM audit_logs ORDER BY action ASC").fetchall()
            actions_list = [a['action'] for a in actions]
            
            return jsonify({
                'logs': [dict(row) for row in logs],
                'total_pages': total_pages,
                'current_page': page,
                'actions': actions_list
            })
        except Exception as e:
            app.logger.error(f"Database error loading audit trail: {e}")
            return jsonify({'error': f'Database error loading audit trail: {e}'}), 500
            
    else:
        return jsonify({'error': 'Invalid action endpoint'}), 400


if __name__ == '__main__':
    # Default host and port configuration
    host = os.environ.get('APP_HOST', 'localhost')
    port = int(os.environ.get('APP_PORT', 8000))
    app.run(host=host, port=port, debug=True)
