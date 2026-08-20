# setup_db.py - Database Initializer & Admin Seed Script for Python/Flask
import os
import sqlite3
import bcrypt

def setup_database():
    db_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), 'database'))
    storage_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), 'storage', 'pdfs'))

    # Create directories
    if not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
        print("Created database directory.")

    if not os.path.exists(storage_dir):
        os.makedirs(storage_dir, exist_ok=True)
        print("Created storage directory.")

    db_path = os.path.join(db_dir, 'db.sqlite')
    schema_path = os.path.join(db_dir, 'schema.sql')

    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        print("Connected to SQLite database successfully.")

        # Read and execute schema
        if not os.path.exists(schema_path):
            raise FileNotFoundError(f"Schema file not found at {schema_path}")

        with open(schema_path, 'r', encoding='utf-8') as schema_file:
            schema_sql = schema_file.read()

        # Execute scripts
        conn.executescript(schema_sql)
        print("Database schema imported successfully.")

        # Seed default administrator if not exists
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM admin_users WHERE username = ?", ('admin',))
        count = cursor.fetchone()[0]

        if count == 0:
            username = 'admin'
            email = '21nikhilnov2006@gmail.com'
            temp_password = 'admin'
            
            # Hash password with bcrypt
            salt = bcrypt.gensalt()
            password_hash = bcrypt.hashpw(temp_password.encode('utf-8'), salt).decode('utf-8')

            # We need to replace the prefix from $2b$ to $2y$ or keep it as is.
            # Actually, standard bcrypt handles $2b$ perfectly. PHP's password_verify also supports $2b$ and $2y$.
            # Let's save it directly.
            cursor.execute("""
                INSERT INTO admin_users (username, email, password_hash, password_changed, status)
                VALUES (?, ?, ?, 0, 'active')
            """, (username, email, password_hash))
            conn.commit()
            print("Default admin user created successfully:")
            print(f"  Username: {username}")
            print(f"  Email: {email}")
            print(f"  Temp Password: {temp_password} (Require password change on first login)")
        else:
            print("Admin user 'admin' already exists. Skipping seed.")

        conn.close()
        print("\nSetup completed successfully! Ready to run on localhost.")

    except Exception as e:
        print(f"Setup failed: {e}")
        raise e

if __name__ == '__main__':
    setup_database()
