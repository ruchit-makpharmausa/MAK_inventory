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
PORT=3001
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

Requires Node.js 20 or later.

```powershell
npm install
npm run check:db
npm run build
npm start
```

Open `http://localhost:3001` on this PC. Other computers use `http://<this-PC-IP>:3001`. Both the website and `/api` are served from that address. `SQLSERVER_HOST` identifies the database server; the website address identifies whichever PC runs Node.js.

For development, `npm run dev` starts the Vite frontend on port 5173 with API requests forwarded to port 3001. Use `npm start` to serve the built website and API together.

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
