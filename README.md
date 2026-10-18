# MAK Inventory Management System

React + Vite frontend with a Node.js/Express backend connected to your existing Microsoft SQL Server database. The app does not install a database, create tables, seed records, or migrate data automatically.

## Existing server connection

The server connection is configured in the local `.env` file:

```dotenv
SQLSERVER_HOST=192.168.1.114
SQLSERVER_PORT=1433
SQLSERVER_DATABASE=mak_inventory
SQLSERVER_USER=mak_inventory_app
SQLSERVER_PASSWORD=
SQLSERVER_CA_FILE=./scripts/MAKPHARMA-SQL.pem
SQLSERVER_TRUST_SERVER_CERTIFICATE=false
SQLSERVER_TLS_SERVER_NAME=MAKPHARMA
PORT=567
HOST=0.0.0.0
```

Enter the actual password locally. Quote passwords containing `#` or spaces. `.env` is excluded from source control; `.env.example` contains the configuration names without a password.

Connections use SQL Server Authentication with encryption required. Certificate verification stays enabled by default. The configured server certificate identifies `MAKPHARMA`, so `SQLSERVER_TLS_SERVER_NAME=MAKPHARMA` verifies that identity while connecting to `192.168.1.114`. The supplied public certificate is preserved in `scripts/MAKPHARMA-SQL.cer`; `scripts/MAKPHARMA-SQL.pem` contains its PEM representation for the app's trust configuration. For a different server certificate, update the public certificate and matching TLS name.

Only set `SQLSERVER_TRUST_SERVER_CERTIFICATE=true` when you explicitly intend to skip server certificate verification; the connection remains encrypted. The current configuration uses certificate verification.

## Export the public certificate

On the SQL Server PC:

1. Open SQL Server Configuration Manager, then SQL Server Network Configuration, Protocols for your instance, Properties, Certificate. Identify the configured certificate.
2. Run `certlm.msc`, then open Personal, Certificates and find that certificate.
3. Right-click it, choose All Tasks, Export, then **No, do not export the private key**.
4. Choose **Base-64 encoded X.509 (.CER)**. Copy the public certificate to this app's PC and enter its local path in `SQLSERVER_CA_FILE`.
5. Use the certificate's DNS name in `SQLSERVER_TLS_SERVER_NAME` if its identity differs from the connection IP.

If no certificate is selected, SQL Server may be using an automatically generated fallback certificate. For this LAN setup, copy `scripts/setup-sqlserver-certificate.ps1` to the SQL Server PC and run it in Windows PowerShell as Administrator. It verifies that it is on the PC with address `192.168.1.114`, creates a dedicated certificate including that IP and the PC's DNS names, grants the selected SQL Server service read access to its private key, and exports only a public PEM file to the desktop. This certificate is self-signed and becomes trusted by this app only when its public certificate is explicitly configured in `SQLSERVER_CA_FILE`; it is not a certificate issued by a company or public CA.

Select the generated certificate in SQL Server Configuration Manager and restart the SQL Server service when ready. The restart briefly interrupts database connections. The script does not select a certificate or restart services automatically. Copy the exported PEM file to this app's PC and provide its local path so the connection can be completed with certificate verification enabled. A company CA-issued SQL Server certificate can be used instead. See [Microsoft's certificate requirements](https://learn.microsoft.com/en-us/sql/database-engine/configure-windows/certificate-requirements?view=sql-server-ver17).

## Run the app under one IP and port

Install [Node.js LTS](https://nodejs.org/en/download) and [Git for Windows](https://git-scm.com/install/windows) on the server PC. Reopen PowerShell after installing them.

```powershell
npm install
npm run check:db
npm run build
npm start
```

The intended server address is **http://192.168.1.114:567**. Run the app on the PC that owns `192.168.1.114` to serve both the website and `/api` at that address. `HOST=0.0.0.0` accepts network connections on port `567`; setting the database address alone does not move the website to that PC.

### Start on the server PC (192.168.1.114)

1. Verify that the server PC has IP address `192.168.1.114` using `ipconfig`. Keep this address assigned to that PC through your network's existing static address or DHCP reservation.
2. For the first installation, open PowerShell on that PC and clone the repository into a new folder:

   ```powershell
   git clone https://github.com/ruchit-makpharmausa/MAK_inventory.git C:\MAKInventory
   Set-Location C:\MAKInventory
   if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
   notepad .env
   ```

   Enter the actual SQL password in the server's `.env`, save it, and close Notepad. Keep `PORT=567`, `HOST=0.0.0.0`, and the SQL Server and certificate settings shown above. The public certificate files are included in `scripts/`. Each PC keeps its own `.env`; it is excluded from Git.
3. Run:

   ```powershell
   npm ci
   npm run check:db
   npm run build
   npm start
   ```

4. Keep that PowerShell window open while the app is running. In a browser on the server PC, verify `http://localhost:567/api/health`; a working database connection returns `{"status":"ok","database":"sqlserver"}`. Then open `http://192.168.1.114:567` from another computer on the network.

If Windows Firewall blocks access from other computers, run this once in an Administrator PowerShell on the server PC:

```powershell
New-NetFirewallRule -DisplayName "MAK Inventory TCP 567" -Direction Inbound -Action Allow -Protocol TCP -LocalAddress 192.168.1.114 -LocalPort 567 -Profile Private,Domain
```

The website uses port `567`. SQL Server continues to use port `1433` with certificate verification enabled. These steps do not create or change database objects.

## Sign-in setup

The home page requires a username and password before opening the inventory dashboard. To create the login tables, select the existing inventory database in SQL Server Management Studio and run [scripts/login-tables.sql](./scripts/login-tables.sql). This separate SQL script creates only `dbo.app_users` and `dbo.user_sessions`; it does not create a database or change inventory data.

For a new installation, create the first **administrator** account from PowerShell in the app folder. Run the commands one line at a time; the password must be at least 12 characters. Existing installations must complete the admin upgrade below before starting the updated app.

```powershell
$env:APP_USER_NAME = "your.username"
$env:APP_USER_DISPLAY_NAME = "Your Name"
$env:APP_USER_ROLE = "admin"
$securePassword = Read-Host "Choose a password (12-256 characters)" -AsSecureString
$env:APP_USER_PASSWORD = [System.Net.NetworkCredential]::new("", $securePassword).Password
try { npm.cmd run create:user } finally {
  Remove-Variable securePassword -ErrorAction SilentlyContinue
  Remove-Item Env:APP_USER_NAME, Env:APP_USER_DISPLAY_NAME, Env:APP_USER_PASSWORD, Env:APP_USER_ROLE -ErrorAction SilentlyContinue
}
```

The account command stores a salted password hash, not the plaintext password. `APP_USER_ROLE` defaults to `user`; set it to `admin` only for trusted administrators. Sign-in sessions are stored in SQL Server and expire after eight hours. The app's SQL login needs the permissions listed at the end of [scripts/login-tables.sql](./scripts/login-tables.sql).

### Admin panel and existing-account upgrade

For existing installations, stop the app and open [scripts/user-admin-upgrade.sql](./scripts/user-admin-upgrade.sql) in SQL Server Management Studio against the inventory database. Replace `REPLACE_WITH_EXISTING_USERNAME` with the username of the trusted, active account that should be an administrator, then execute as a database administrator and restart the updated app. The script adds `is_admin` with a default of false and promotes only the explicitly selected account. It rolls back if that account is not found. It can be rerun; it does not change inventory data, passwords, or existing administrator assignments. No schema changes run automatically. Running the login-table script alone does not upgrade an existing users table.

Sign in as an administrator and select **Admin Panel** in the sidebar. Enter a display name, unique username, role (User by default), password, and matching confirmation, then choose **Add user**. Passwords require 12–256 characters. New accounts are active immediately and appear in the users list; share their password securely. The form clears after a successful save. Account editing, deletion, and password resets are not included.

Only administrators can list or add users, including when calling `GET /api/users` or `POST /api/users` directly. Regular users retain inventory access without seeing the admin navigation. Administrator access is checked against the current database record on every API request. Account responses never include password hashes.

### Publish updates from the development PC

Make code changes on the development PC and push them to the repository's `main` branch. After each push, update the running server as follows:

1. On the server PC, press **Ctrl+C** in the PowerShell window running the app. Updating briefly interrupts the website.
2. In that window, run:

   ```powershell
   Set-Location C:\MAKInventory
   git pull --ff-only origin main
   npm ci
   npm run check:db
   npm run build
   npm start
   ```

   Run the commands one at a time and continue only when each command succeeds. If Git reports local edits or a merge conflict, resolve those edits before continuing.
3. Verify `http://192.168.1.114:567/api/health`, then refresh the website. Git updates the code while the server's ignored `.env` retains its password and settings. Application updates leave the existing SQL Server data in place.

With this manual startup method, start the app again with `Set-Location C:\MAKInventory` followed by `npm start` after a server restart. The server PC must remain powered on, awake, and connected to the network for the website to be available.

For development, `npm run dev` starts the Vite frontend on port `5173` and forwards API requests to the backend port configured by `PORT` (default `567`). Use `npm start` to serve the built website and API together.

## Existing tables

The app checks for these existing tables in schema `dbo`:

- `product_types`: `id`, `name`, `created_at`
- `products`: `id`, `product_type_id`, `name`, `item_code`, `mak_item_code`, `unit`, `comment`, `created_at`, `updated_at`
- `receiving_transactions`: `id`, `product_id`, `receiving_date`, `quantity`, `material_lot_number`, `remarks`, `created_at`
- `usage_transactions`: `id`, `product_id`, `usage_date`, `quantity`, `material_lot_number`, `mak_lot_number`, `remarks`, `created_at`

IDs are expected to be integer identity columns. Existing unique constraints should enforce unique item codes and product type names. The login needs SELECT, INSERT, and UPDATE permissions on these inventory tables, plus visibility of their column metadata. The app does not need permission to create database objects.

A connection failure or missing column returns an explicit error; the app never switches to a local database. Previous SQLite files and backups remain untouched and are not used by the app.

## Inventory behavior

- Product Master saves Item Code, MAK Item Code, Comment, and Unit (Pcs or kgs).
- Search supports product names and both item codes.
- Stock is calculated from receiving minus usage transactions.
- Receiving and usage acquire a SQL Server update lock on the product within a transaction to coordinate concurrent requests.
- Lot-tracked inventory requires a material lot and checks its available balance.
- CSV exports include the product fields and transaction history.

## Validation

```powershell
npm test
npm run build
npm run check:db
```

Tests cover API behavior with a stubbed database, connection configuration, mandatory encryption, schema checking without object creation, and usage guards. `check:db` performs read-only checks against the actual server; it does not add test records. No database server is installed or created by these commands.
