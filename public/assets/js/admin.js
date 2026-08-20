// admin.js - Admin Panel Client interactions

document.addEventListener('DOMContentLoaded', function() {
    initTabs();
    loadDashboardStats();
    loadUsers();
    loadDocs();
    loadLogs();
    initUploadZone();
    initForms();
});

// CSRF helper
function getCsrfToken() {
    return document.getElementById('csrf-token-global').value;
}

// Host helper to generate user links
function getBaseUrl() {
    // Strip /admin/* from path to get root, works for /admin/index.html and /admin/
    const base = window.location.origin + window.location.pathname.replace(/\/admin\/.*$/, '');
    return base + '/index.html';
}

// ----------------------------------------------------
// TAB SYSTEM NAVIGATION
// ----------------------------------------------------
function initTabs() {
    const links = document.querySelectorAll('.sidebar-link');
    links.forEach(link => {
        link.addEventListener('click', function() {
            links.forEach(l => l.classList.remove('active'));
            this.classList.add('active');
            
            const target = this.getAttribute('data-target');
            document.querySelectorAll('.tab-panel-section').forEach(section => {
                section.style.display = 'none';
            });
            
            document.getElementById(target).style.display = 'block';
            
            // Reload context-specific data
            if (target === 'tab-dashboard') loadDashboardStats();
            else if (target === 'tab-users') loadUsers();
            else if (target === 'tab-documents') loadDocs();
            else if (target === 'tab-logs') loadLogs();
        });
        
        // Accessibility: Keyboard support
        link.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.click();
            }
        });
    });
}

// ----------------------------------------------------
// TOAST NOTIFICATIONS
// ----------------------------------------------------
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
    toast.innerHTML = `<i class="fa-solid ${icon}" style="margin-right: 8px;"></i> ${message}`;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ----------------------------------------------------
// DASHBOARD VIEW
// ----------------------------------------------------
function loadDashboardStats() {
    fetch('api?action=stats')
        .then(res => res.json())
        .then(data => {
            if (data.error) return;
            document.getElementById('stat-total-users').innerText = data.total_users;
            document.getElementById('stat-total-docs').innerText = data.total_docs;
            document.getElementById('stat-total-opens').innerText = data.total_opens;
            document.getElementById('stat-failed-access').innerText = data.failed_access;
        })
        .catch(() => showToast('Failed to load dashboard statistics', 'error'));
}

// ----------------------------------------------------
// RECIPIENT MANAGEMENT
// ----------------------------------------------------
function loadUsers() {
    fetch('api?action=get_users')
        .then(res => res.json())
        .then(users => {
            const tbody = document.getElementById('users-table-body');
            tbody.innerHTML = '';
            
            if (users.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No recipients registered. Create one below!</td></tr>`;
                return;
            }
            
            users.forEach(user => {
                const tr = document.createElement('tr');
                const linkUrl = `${getBaseUrl()}?token=${user.access_token}`;
                
                const statusBadge = user.status === 'active' 
                    ? '<span class="badge badge-active">Active</span>' 
                    : '<span class="badge badge-disabled">Revoked</span>';
                
                const toggleActionText = user.status === 'active' ? 'Revoke Access' : 'Enable Access';
                const toggleIcon = user.status === 'active' ? 'fa-user-slash' : 'fa-user-check';
                
                tr.innerHTML = `
                    <td><strong>${escapeHtml(user.name)}</strong></td>
                    <td>${escapeHtml(user.email)}</td>
                    <td>${statusBadge}</td>
                    <td>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <input type="text" class="form-input" style="padding:6px; font-size:12px; max-width:180px;" value="${linkUrl}" readonly id="token-input-${user.id}">
                            <button class="btn-secondary-premium" style="padding:6px 12px; font-size:12px;" onclick="copyToClipboard('token-input-${user.id}')" title="Copy Access URL">
                                <i class="fa-solid fa-copy"></i>
                            </button>
                        </div>
                    </td>
                    <td>
                        <div style="display:flex; gap:6px;">
                            <button class="btn-secondary-premium" style="padding:6px 12px; font-size:12px;" onclick="openPermissionsModal(${user.id}, '${escapeHtml(user.name)}')">
                                <i class="fa-solid fa-key"></i> Permissions
                            </button>
                            <button class="btn-secondary-premium" style="padding:6px 12px; font-size:12px;" onclick="toggleUser(${user.id}, '${user.status === 'active' ? 'disabled' : 'active'}')">
                                <i class="fa-solid ${toggleIcon}"></i> ${toggleActionText}
                            </button>
                            <button class="btn-secondary-premium" style="padding:6px 12px; font-size:12px;" onclick="regenerateToken(${user.id})">
                                <i class="fa-solid fa-arrows-rotate"></i> Reset URL
                            </button>
                            <button class="btn-danger-premium" style="padding:4px 10px; font-size:12px;" onclick="deleteUser(${user.id})">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        });
}

function toggleUser(id, newStatus) {
    const fd = new FormData();
    fd.append('id', id);
    fd.append('status', newStatus);
    fd.append('csrf_token', getCsrfToken());
    
    fetch('api?action=toggle_user', { method: 'POST', body: fd })
        .then(res => res.json())
        .then(data => {
            if (data.error) showToast(data.error, 'error');
            else {
                showToast(data.message);
                loadUsers();
            }
        });
}

function regenerateToken(id) {
    if (!confirm('Are you sure you want to rotate this recipient\'s access URL? The previous URL will stop working immediately.')) return;
    
    const fd = new FormData();
    fd.append('id', id);
    fd.append('csrf_token', getCsrfToken());
    
    fetch('api?action=regenerate_token', { method: 'POST', body: fd })
        .then(res => res.json())
        .then(data => {
            if (data.error) showToast(data.error, 'error');
            else {
                showToast(data.message);
                loadUsers();
            }
        });
}

function deleteUser(id) {
    if (!confirm('Are you sure you want to delete this recipient permanently? All permissions and audit linkages will be deleted.')) return;
    
    const fd = new FormData();
    fd.append('id', id);
    fd.append('csrf_token', getCsrfToken());
    
    fetch('api?action=delete_user', { method: 'POST', body: fd })
        .then(res => res.json())
        .then(data => {
            if (data.error) showToast(data.error, 'error');
            else {
                showToast(data.message);
                loadUsers();
            }
        });
}

function copyToClipboard(inputId) {
    const copyText = document.getElementById(inputId);
    copyText.select();
    copyText.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(copyText.value);
    showToast('Unique access URL copied to clipboard');
}

// ----------------------------------------------------
// DOCUMENT AND FILE MANAGER VIEW
// ----------------------------------------------------
let currentFolderId = '';

function loadDocs(folderId = '') {
    currentFolderId = folderId;
    fetch(`api?action=get_docs&folder_id=${folderId}`)
        .then(res => res.json())
        .then(data => {
            // Update breadcrumbs
            const breadcrumb = document.getElementById('docs-breadcrumb');
            breadcrumb.innerHTML = '<span class="breadcrumb-item" onclick="loadDocs(\'\')">Root</span>';
            data.breadcrumbs.forEach((crumb, idx) => {
                const span = document.createElement('span');
                span.className = 'breadcrumb-item';
                if (idx === data.breadcrumbs.length - 1) {
                    span.innerText = crumb.name;
                } else {
                    span.innerText = crumb.name;
                    span.onclick = () => loadDocs(crumb.id);
                }
                breadcrumb.appendChild(span);
            });
            
            // Render directory selector options
            updateDirectorySelects(data.folders, folderId);
            
            // Render file list grid
            const list = document.getElementById('file-manager-list');
            list.innerHTML = '';
            
            if (data.folders.length === 0 && data.documents.length === 0) {
                list.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">This directory is empty.</p>';
                return;
            }
            
            // Folders list
            data.folders.forEach(folder => {
                const item = document.createElement('div');
                item.className = 'glass-panel';
                item.style.padding = '12px 18px';
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.justifyContent = 'space-between';
                item.style.cursor = 'pointer';
                
                item.innerHTML = `
                    <div style="display:flex; align-items:center; gap:12px;" onclick="loadDocs(${folder.id})">
                        <i class="fa-solid fa-folder" style="font-size:24px; color:var(--primary);"></i>
                        <strong>${escapeHtml(folder.name)}</strong>
                    </div>
                    <button class="btn-danger-premium" style="padding:4px 8px; font-size:11px;" onclick="deleteFolder(${folder.id})">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                `;
                list.appendChild(item);
            });
            
            // Files list
            data.documents.forEach(doc => {
                const item = document.createElement('div');
                item.className = 'glass-panel';
                item.style.padding = '12px 18px';
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.justifyContent = 'space-between';
                
                const sizeStr = formatBytes(doc.file_size);
                
                item.innerHTML = `
                    <div style="display:flex; align-items:center; gap:12px;">
                        <i class="fa-solid fa-file-pdf" style="font-size:24px; color:#f87171;"></i>
                        <div>
                            <strong>${escapeHtml(doc.original_name)}</strong>
                            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
                                ${sizeStr} &bull; ${doc.page_count} Pages
                            </div>
                        </div>
                    </div>
                    <button class="btn-danger-premium" style="padding:4px 8px; font-size:11px;" onclick="deleteFile(${doc.id})">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                `;
                list.appendChild(item);
            });
        });
}

function updateDirectorySelects(folders, currentId) {
    const selects = [
        document.getElementById('upload-folder-select'),
        document.getElementById('parent-folder-select')
    ];
    
    selects.forEach(select => {
        if (!select) return;
        // Keep root option
        select.innerHTML = '<option value="">[Root Directory]</option>';
        
        // Add current folders list (In a real hierarchy we might recursively fetch all folders,
        // but for V1, listing folders at current level or doing a quick list is sufficient)
        fetch('api?action=get_docs&folder_id=')
            .then(res => res.json())
            .then(data => {
                // Render root directories
                data.folders.forEach(f => {
                    const opt = document.createElement('option');
                    opt.value = f.id;
                    opt.innerText = f.name;
                    if (f.id == currentId) opt.selected = true;
                    select.appendChild(opt);
                });
            });
    });
}

function deleteFolder(id) {
    if (!confirm('Are you sure you want to delete this folder? Sub-directories must be empty to be deleted.')) return;
    
    const fd = new FormData();
    fd.append('id', id);
    fd.append('csrf_token', getCsrfToken());
    
    fetch('api?action=delete_folder', { method: 'POST', body: fd })
        .then(res => res.json())
        .then(data => {
            if (data.error) showToast(data.error, 'error');
            else {
                showToast(data.message);
                loadDocs(currentFolderId);
            }
        });
}

function deleteFile(id) {
    if (!confirm('Are you sure you want to delete this PDF file from disk permanently?')) return;
    
    const fd = new FormData();
    fd.append('id', id);
    fd.append('csrf_token', getCsrfToken());
    
    fetch('api?action=delete_file', { method: 'POST', body: fd })
        .then(res => res.json())
        .then(data => {
            if (data.error) showToast(data.error, 'error');
            else {
                showToast(data.message);
                loadDocs(currentFolderId);
            }
        });
}

// ----------------------------------------------------
// DRAG AND DROP FILE UPLOAD DRAG/DROP
// ----------------------------------------------------
function initUploadZone() {
    const dropzone = document.getElementById('pdf-upload-dropzone');
    const fileInput = document.getElementById('pdf-file-input');
    
    if (!dropzone) return;
    
    dropzone.addEventListener('click', () => fileInput.click());
    
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });
    
    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });
    
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileUpload(e.target.files[0]);
        }
    });
}

function handleFileUpload(file) {
    if (file.type !== 'application/pdf') {
        showToast('Only PDF files are allowed', 'error');
        return;
    }
    
    const progressBox = document.getElementById('upload-progress-box');
    const filenameLabel = document.getElementById('upload-filename');
    const percentLabel = document.getElementById('upload-percentage');
    const progressFill = document.getElementById('upload-progress-fill');
    
    filenameLabel.innerText = file.name;
    progressBox.style.display = 'block';
    progressFill.style.width = '0%';
    percentLabel.innerText = '0%';
    
    const fd = new FormData();
    fd.append('pdf_file', file);
    fd.append('folder_id', document.getElementById('upload-folder-select').value);
    fd.append('csrf_token', getCsrfToken());
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api?action=upload_file', true);
    
    xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            progressFill.style.width = percent + '%';
            percentLabel.innerText = percent + '%';
        }
    };
    
    xhr.onload = function() {
        progressBox.style.display = 'none';
        let res;
        try {
            res = JSON.parse(xhr.responseText);
        } catch(err) {
            showToast('JSON parsing upload error', 'error');
            return;
        }
        
        if (xhr.status === 200) {
            showToast(res.message);
            loadDocs(currentFolderId);
        } else {
            showToast(res.error || 'Upload failed', 'error');
        }
    };
    
    xhr.onerror = function() {
        progressBox.style.display = 'none';
        showToast('Upload network request error', 'error');
    };
    
    xhr.send(fd);
}

// ----------------------------------------------------
// FORMS SUBMISSION
// ----------------------------------------------------
function initForms() {
    const addUserForm = document.getElementById('add-user-form');
    if (addUserForm) {
        addUserForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const fd = new FormData();
            fd.append('name', document.getElementById('user-name-input').value);
            fd.append('email', document.getElementById('user-email-input').value);
            fd.append('csrf_token', getCsrfToken());
            
            fetch('api?action=create_user', { method: 'POST', body: fd })
                .then(res => res.json())
                .then(data => {
                    if (data.error) showToast(data.error, 'error');
                    else {
                        showToast(data.message);
                        closeModal('modal-add-user');
                        addUserForm.reset();
                        loadUsers();
                    }
                });
        });
    }
    
    const createFolderForm = document.getElementById('create-folder-form');
    if (createFolderForm) {
        createFolderForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const fd = new FormData();
            fd.append('name', document.getElementById('new-folder-name').value);
            fd.append('parent_id', document.getElementById('parent-folder-select').value);
            fd.append('csrf_token', getCsrfToken());
            
            fetch('api?action=create_folder', { method: 'POST', body: fd })
                .then(res => res.json())
                .then(data => {
                    if (data.error) showToast(data.error, 'error');
                    else {
                        showToast(data.message);
                        createFolderForm.reset();
                        loadDocs(currentFolderId);
                    }
                });
        });
    }
}

// ----------------------------------------------------
// PERMISSIONS ASSIGNMENTS MODAL
// ----------------------------------------------------
let activePermTab = 'docs';

function openPermissionsModal(userId, name) {
    document.getElementById('perm-user-id').value = userId;
    document.getElementById('perm-user-title').innerText = `User: ${name}`;
    
    togglePermTabs('docs');
    loadUserPermissions(userId);
    openModal('modal-permissions');
}

function togglePermTabs(tab) {
    activePermTab = tab;
    const docsBtn = document.getElementById('tab-perm-docs-btn');
    const foldersBtn = document.getElementById('tab-perm-folders-btn');
    
    const docsList = document.getElementById('perm-docs-checklist');
    const foldersList = document.getElementById('perm-folders-checklist');
    
    if (tab === 'docs') {
        docsBtn.style.color = 'var(--primary)';
        foldersBtn.style.color = 'var(--text-muted)';
        docsList.style.display = 'flex';
        foldersList.style.display = 'none';
    } else {
        docsBtn.style.color = 'var(--text-muted)';
        foldersBtn.style.color = 'var(--primary)';
        docsList.style.display = 'none';
        foldersList.style.display = 'flex';
    }
}

function loadUserPermissions(userId) {
    const docsList = document.getElementById('perm-docs-checklist');
    const foldersList = document.getElementById('perm-folders-checklist');
    
    docsList.innerHTML = '<p style="color:var(--text-muted); text-align:center;">Loading documents...</p>';
    foldersList.innerHTML = '<p style="color:var(--text-muted); text-align:center;">Loading folders...</p>';
    
    fetch(`api?action=get_permissions&user_id=${userId}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            
            // Docs Checklist
            docsList.innerHTML = '';
            if (data.all_docs.length === 0) {
                docsList.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center;">No documents available. Upload some first.</p>';
            } else {
                data.all_docs.forEach(doc => {
                    const isChecked = data.assigned_docs.includes(doc.id);
                    docsList.appendChild(createPermissionRow(userId, 'document', doc.id, doc.name, isChecked));
                });
            }
            
            // Folders Checklist
            foldersList.innerHTML = '';
            if (data.all_folders.length === 0) {
                foldersList.innerHTML = '<p style="color:var(--text-muted); font-size:13px; text-align:center;">No folders available. Create some first.</p>';
            } else {
                data.all_folders.forEach(fold => {
                    const isChecked = data.assigned_folders.includes(fold.id);
                    foldersList.appendChild(createPermissionRow(userId, 'folder', fold.id, fold.name, isChecked));
                });
            }
        });
}

function createPermissionRow(userId, type, itemId, name, isChecked) {
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.gap = '10px';
    div.style.padding = '8px 12px';
    div.style.background = 'rgba(255,255,255,0.02)';
    div.style.borderRadius = '6px';
    
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = isChecked;
    input.style.width = '16px';
    input.style.height = '16px';
    
    input.addEventListener('change', function() {
        const action = this.checked ? 'set_permission' : 'remove_permission';
        
        const fd = new FormData();
        fd.append('user_id', userId);
        fd.append('type', type);
        fd.append('item_id', itemId);
        fd.append('csrf_token', getCsrfToken());
        
        fetch(`api?action=${action}`, { method: 'POST', body: fd })
            .then(res => res.json())
            .then(data => {
                if (data.error) {
                    showToast(data.error, 'error');
                    // Revert check
                    input.checked = !input.checked;
                } else {
                    showToast('Permissions updated successfully');
                }
            });
    });
    
    const label = document.createElement('label');
    label.innerText = name;
    label.style.fontSize = '14px';
    
    div.appendChild(input);
    div.appendChild(label);
    return div;
}

// ----------------------------------------------------
// AUDIT LOG MANAGEMENT
// ----------------------------------------------------
let logsPage = 1;

function loadLogs(page = 1) {
    logsPage = page;
    const actionVal = document.getElementById('log-action-filter').value;
    const statusVal = document.getElementById('log-status-filter').value;
    
    fetch(`api?action=get_logs&page=${page}&action_filter=${actionVal}&status_filter=${statusVal}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            
            // Update filter dropdown options once (for actions)
            const actionSel = document.getElementById('log-action-filter');
            if (actionSel.children.length === 1 && data.actions) {
                data.actions.forEach(act => {
                    const opt = document.createElement('option');
                    opt.value = act;
                    opt.innerText = act.replace(/_/g, ' ');
                    actionSel.appendChild(opt);
                });
                
                // Add event listeners to filters to reload on change
                actionSel.addEventListener('change', () => loadLogs(1));
                document.getElementById('log-status-filter').addEventListener('change', () => loadLogs(1));
            }
            
            // Build logs list
            const tbody = document.getElementById('logs-table-body');
            tbody.innerHTML = '';
            
            if (data.logs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No audit logs found.</td></tr>`;
                return;
            }
            
            data.logs.forEach(log => {
                const tr = document.createElement('tr');
                const userText = log.user_name ? `${escapeHtml(log.user_name)} (${escapeHtml(log.user_email)})` : '<em style="color:var(--text-muted);">System / Administrator</em>';
                const docText = log.doc_name ? escapeHtml(log.doc_name) : '-';
                
                let badgeClass = 'badge-active';
                if (log.status === 'denied' || log.status === 'failure') badgeClass = 'badge-disabled';
                
                tr.innerHTML = `
                    <td style="font-size:12px; white-space:nowrap;">${log.timestamp}</td>
                    <td style="font-size:13px;">${userText}</td>
                    <td style="font-size:13px; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${docText}</td>
                    <td><code style="color:var(--primary); font-size:12px;">${log.action}</code></td>
                    <td style="font-size:12px;">${escapeHtml(log.ip_address)}</td>
                    <td><span class="badge ${badgeClass}">${log.status}</span></td>
                `;
                tbody.appendChild(tr);
            });
            
            // Render pagination
            renderLogsPagination(data.total_pages, data.current_page);
        });
}

function renderLogsPagination(totalPages, currentPage) {
    const pag = document.getElementById('logs-pagination');
    pag.innerHTML = '';
    
    if (totalPages <= 1) return;
    
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);
    
    if (currentPage > 1) {
        const prev = document.createElement('button');
        prev.className = 'pagination-btn';
        prev.innerHTML = '<i class="fa-solid fa-angle-left"></i>';
        prev.onclick = () => loadLogs(currentPage - 1);
        pag.appendChild(prev);
    }
    
    for (let i = start; i <= end; i++) {
        const btn = document.createElement('button');
        btn.className = `pagination-btn ${i === currentPage ? 'active' : ''}`;
        btn.innerText = i;
        btn.onclick = () => loadLogs(i);
        pag.appendChild(btn);
    }
    
    if (currentPage < totalPages) {
        const next = document.createElement('button');
        next.className = 'pagination-btn';
        next.innerHTML = '<i class="fa-solid fa-angle-right"></i>';
        next.onclick = () => loadLogs(currentPage + 1);
        pag.appendChild(next);
    }
}

// ----------------------------------------------------
// MODAL CONTROLS SYSTEM
// ----------------------------------------------------
function openModal(id) {
    document.getElementById(id).style.display = 'flex';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

function closeModalOnOverlay(e) {
    if (e.target.className === 'modal-overlay') {
        e.target.style.display = 'none';
    }
}

// ----------------------------------------------------
// UTILITIES
// ----------------------------------------------------
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
