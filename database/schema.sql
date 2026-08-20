-- Schema for Secure PDF Distribution & Accessible Document Reader (SQLite)

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_changed INTEGER DEFAULT 0, -- 0 = Must change, 1 = Changed
    status TEXT DEFAULT 'active', -- active, disabled
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME
);

-- End-users (recipients) table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    access_token TEXT UNIQUE NOT NULL, -- Cryptographically secure token
    status TEXT DEFAULT 'active', -- active, disabled
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_access_at DATETIME
);

-- Folders for organization
CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(parent_id) REFERENCES folders(id) ON DELETE CASCADE
);

-- Documents metadata table
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER DEFAULT NULL,
    original_name TEXT NOT NULL,
    storage_path TEXT NOT NULL, -- Relative to storage root
    file_size INTEGER NOT NULL,
    page_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active', -- active, inactive
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE SET NULL
);

-- Permissions linking users to documents or folders
CREATE TABLE IF NOT EXISTS permissions (
    user_id INTEGER NOT NULL,
    document_id INTEGER DEFAULT NULL,
    folder_id INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, document_id, folder_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE CASCADE
);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT NULL, -- Null if guest or admin
    document_id INTEGER DEFAULT NULL,
    action TEXT NOT NULL, -- ACCESS_LINK_OPENED, LIBRARY_VIEWED, DOCUMENT_OPENED, etc.
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT,
    status TEXT, -- success, failure, denied
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE SET NULL
);

-- Database indexes for optimized lookup
CREATE INDEX IF NOT EXISTS idx_users_token ON users(access_token);
CREATE INDEX IF NOT EXISTS idx_permissions_user ON permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents(folder_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_doc ON audit_logs(document_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs(timestamp);
