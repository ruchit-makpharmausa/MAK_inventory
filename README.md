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

For a new installation, create the first **administrator** account from PowerShell in the app folder. Run the commands one line at a time; the password must be at least 6 characters. Existing installations must complete the admin upgrade below before starting the updated app.

```powershell
$env:APP_USER_NAME = "your.username"
$env:APP_USER_DISPLAY_NAME = "Your Name"
$env:APP_USER_ROLE = "admin"
$securePassword = Read-Host "Choose a password (6-256 characters)" -AsSecureString
$env:APP_USER_PASSWORD = [System.Net.NetworkCredential]::new("", $securePassword).Password
try { npm.cmd run create:user } finally {
  Remove-Variable securePassword -ErrorAction SilentlyContinue
  Remove-Item Env:APP_USER_NAME, Env:APP_USER_DISPLAY_NAME, Env:APP_USER_PASSWORD, Env:APP_USER_ROLE -ErrorAction SilentlyContinue
}
```

The account command stores a salted password hash, not the plaintext password. `APP_USER_ROLE` defaults to `user`; set it to `admin` only for trusted administrators. Sign-in sessions are stored in SQL Server and expire after eight hours. The app's SQL login needs the permissions listed at the end of [scripts/login-tables.sql](./scripts/login-tables.sql).

### Admin panel and existing-account upgrade

For existing installations, stop the app and open [scripts/user-admin-upgrade.sql](./scripts/user-admin-upgrade.sql) in SQL Server Management Studio against the inventory database. Replace `REPLACE_WITH_EXISTING_USERNAME` with the username of the trusted, active account that should be an administrator, then execute as a database administrator and restart the updated app. The script adds `is_admin` with a default of false and promotes only the explicitly selected account. It rolls back if that account is not found. It can be rerun; it does not change inventory data, passwords, or existing administrator assignments. No schema changes run automatically. Running the login-table script alone does not upgrade an existing users table.

Sign in as an administrator and select **Admin Panel** in the sidebar. Enter a display name, unique username, role (User by default), password, and matching confirmation, then choose **Add user**. Passwords require 6–256 characters. Existing passwords remain valid and are not changed automatically. New accounts are active immediately and appear in the users list; share their password securely. The form clears after a successful save. Account editing, deletion, and password resets are not included.

Only administrators can list or add users, including when calling `GET /api/users` or `POST /api/users` directly. Regular users retain inventory access without seeing the admin navigation. Administrator access is checked against the current database record on every API request. Account responses never include password hashes.

### SQL Server unavailable or query timeout during sign-in

A `503` response is a database availability problem, unlike `401 Invalid username or password`. Do not reset a password to fix a `503`. From the app server's project folder, run `npm run check:db` using the same `.env` as the running app. A successful TCP connection or `SELECT 1` does not prove inventory/login queries can run; those queries may still be blocked by a schema change or other transaction.

The app distinguishes a connection timeout from a database **query timeout after connecting**. For query timeouts, have a database administrator run [scripts/diagnose-sql-blocking.sql](./scripts/diagnose-sql-blocking.sql) in SQL Server Management Studio. It reads only requests and open transactions for `mak_inventory`, including blocking session IDs, wait types, and session IDs with open transactions. It does not display SQL text or passwords, change accounts, end transactions, or terminate sessions. Server-state visibility permissions are required as noted in the script.

If it identifies blocking (for example `LCK_M_SCH_S` while a schema-upgrade transaction remains open), the transaction's owner should review and explicitly finish it in the **original SSMS query tab**. This read-only check in that original tab shows whether it still owns a transaction:

```sql
SELECT @@TRANCOUNT AS openTransactions;
```

Choose whether to commit or roll back only after reviewing pending work with the database administrator. Do not blindly terminate sessions, rerun schema upgrades, increase timeouts, or disable certificate verification. If no blocker is found, investigate SQL Server load and the reported waits instead. Once queries are responsive, rerun `npm run check:db`, verify `/api/health`, then retry sign-in.

The updated health endpoint performs a zero-row read against `dbo.products` on every request; it no longer treats a cached pool as proof the database is responsive. Deploy the updated backend and restart it to use this check and the more specific timeout messages. Account-check and password-reset commands also require a responsive database.

### Recover an account that cannot sign in

`Invalid username or password` means the account was not found, is inactive, or the password did not match. It is not a firewall or browser-cache error. Website accounts in `dbo.app_users` are separate from the SQL Server credentials in `.env`. Granting administrator status does not set or reset an account's password.

Run these commands **on the app server PC, from its updated project folder**, so they use the same `.env` as the app:

```powershell
$env:APP_USER_NAME = "your.username"
npm.cmd run check:user
```

The check is read-only. It reports the configured server/database and whether the account is missing, inactive, has an unsupported password hash, or is active with a correctly formatted hash. It never displays password hashes. If the account is missing, first verify the username and database; do not create a duplicate account in another database. If it is inactive, have a database administrator review activation; recovery does not reactivate accounts.

To verify the password you already know without changing it, keep `APP_USER_NAME` set and run:

```powershell
$securePassword = Read-Host "Current website password" -AsSecureString
try {
  $env:APP_USER_PASSWORD = [System.Net.NetworkCredential]::new("", $securePassword).Password
  npm.cmd run check:user
} finally {
  Remove-Variable securePassword -ErrorAction SilentlyContinue
  Remove-Item Env:APP_USER_PASSWORD -ErrorAction SilentlyContinue
}
```

When a password is supplied, the check reports whether it matches using the same verifier as website login. Without it, only the account status and hash format are checked. If it matches but the website rejects it, verify both running apps use the same server/database and current backend code; also check Caps Lock, saved/autofilled credentials, and the login-attempt throttle. A 401 with `Invalid username or password` happens before cookies are issued, so changing cookie settings will not fix that error.

To replace the password of an **existing active account**, enter a new password locally (not in chat or directly in SQL):

```powershell
$securePassword = Read-Host "New password (6-256 characters)" -AsSecureString
$confirmation = Read-Host "Confirm new password" -AsSecureString
try {
  $password = [System.Net.NetworkCredential]::new("", $securePassword).Password
  if ($password -cne [System.Net.NetworkCredential]::new("", $confirmation).Password) {
    throw "Passwords do not match. Nothing was changed."
  }
  $env:APP_USER_PASSWORD = $password
  npm.cmd run reset:password
} finally {
  Remove-Variable password, securePassword, confirmation -ErrorAction SilentlyContinue
  Remove-Item Env:APP_USER_NAME, Env:APP_USER_PASSWORD -ErrorAction SilentlyContinue
}
```

Recovery stores a fresh salted hash and revokes that account's existing sessions in one transaction. It never creates or activates an account, changes its role, or changes inventory records. If session deletion fails, the password change rolls back. It requires SELECT on `dbo.app_users`, UPDATE on its `password_hash` column, and DELETE on `dbo.user_sessions`; the normal application grants do not include UPDATE on users. A database administrator can run recovery with an authorized database login rather than broadening the app login's permissions. There is no public password-reset endpoint.

After a successful reset, sign in with the new password at the same website address. No build or server restart is needed just for a password reset. After ten failed attempts from one IP, login is temporarily blocked for 15 minutes; resetting the password does not bypass this throttle. Never paste a plaintext password into `password_hash` or share passwords or hashes in diagnostic output.

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

## Page URLs and frontend folders

The app uses browser URL routing on the same host and port. For example, `http://localhost:567/dashboard` and `http://192.168.1.114:567/dashboard` open the same dashboard on their respective app servers; nothing is hardcoded to either hostname.

| URL path | Page module | Access |
| --- | --- | --- |
| `/login` | [LoginPage](./src/pages/login/LoginPage.jsx) | Sign in; signed-in users return to the requested page or dashboard |
| `/dashboard` | [DashboardPage](./src/pages/dashboard/DashboardPage.jsx) | Signed-in users |
| `/products` | [ProductsPage](./src/pages/products/ProductsPage.jsx) | Signed-in users |
| `/receiving` | [ReceivingPage](./src/pages/receiving/ReceivingPage.jsx) | Signed-in users |
| `/usage` | [UsagePage](./src/pages/usage/UsagePage.jsx) | Signed-in users |
| `/inv_history` | [InventoryHistoryPage](./src/pages/history/InventoryHistoryPage.jsx) | Signed-in users |
| `/admin` | [AdminPage](./src/pages/admin/AdminPage.jsx) | Administrators only |

The root `/` opens the dashboard after sign-in. Opening a protected link while signed out redirects to `/login`, then returns to that page after successful authentication. Non-administrators who open `/admin` return to `/dashboard`. Unknown page URLs show a not-found page. The sidebar uses real links, so opening a page in a new tab and browser Back/Forward work normally.

Product history selection is saved in the URL, for example `/inv_history?productId=17`, and survives refreshes and shared links. `/history` is an alias that redirects to `/inv_history`, preserving its query parameters. The production Express server serves the React app for direct page requests and refreshes, while `/api` continues to use its existing authentication and JSON responses.

Frontend organization:

```text
src/
  App.jsx                 Shared application state and route definitions
  main.jsx                BrowserRouter entry point
  pages/
    login/LoginPage.jsx
    dashboard/DashboardPage.jsx
    products/ProductsPage.jsx
    receiving/ReceivingPage.jsx
    usage/UsagePage.jsx
    history/InventoryHistoryPage.jsx
    admin/AdminPage.jsx
    not-found/NotFoundPage.jsx
  components/             Shared layout, route guard, tables, modal and transaction form
  lib/                    API requests, formatting, CSV/Excel export and navigation helpers
```

For development, use the same paths on Vite's port, such as `http://localhost:5173/products`. For deployment, update the full project on the server PC, run `npm ci` and `npm run build`, then restart with `npm start`; deploying only the old built frontend will not add these routes. Existing inventory operations, authentication, and the six-character password minimum are unchanged.

## Existing tables

The app checks for these existing tables in schema `dbo`:

- `product_types`: `id`, `name`, `created_at`
- `products`: `id`, `product_type_id`, `name`, `item_code`, `mak_item_code`, `unit`, `comment`, `created_at`, `updated_at`
- `receiving_transactions`: `id`, `product_id`, `receiving_date`, `quantity`, `material_lot_number`, `mak_release_number`, `remarks`, `created_at`
- `usage_transactions`: `id`, `product_id`, `usage_date`, `quantity`, `material_lot_number`, `mak_lot_number`, `remarks`, `created_at`

IDs are expected to be integer identity columns. Unique constraints must enforce unique `(product_type_id, item_code)` pairs and unique product type names; item codes are not globally unique. The login needs SELECT, INSERT, and UPDATE permissions on these inventory tables, plus visibility of their column metadata. The app does not need permission to create database objects.

A connection failure or missing column returns an explicit error; the app never switches to a local database. Previous SQLite files and backups remain untouched and are not used by the app.

### Item Code uniqueness per product type upgrade

The same product name and Item Code can be used in different types such as Bulk, IFC, and Label. Within one type, an Item Code must remain unique. Product names stay exactly as entered apart from trimming surrounding whitespace; no type suffix is added. Each record keeps its own product ID, balances, and transaction history. The history picker and recent transactions display the type to distinguish otherwise identical products.

Before starting the updated app, stop the app, back up the database, and run [scripts/product-item-code-per-type.sql](./scripts/product-item-code-per-type.sql) as a database administrator in SQL Server Management Studio against the existing inventory database. The script adds `UNIQUE (product_type_id, item_code)` (or keeps an equivalent existing unique key), then discovers and removes unique constraints or standalone unique indexes whose only key column is `item_code`. Generated constraint names do not need to be edited manually. Both changes run in one transaction; no product names, codes, IDs, or transaction data are rewritten. Existing product-type uniqueness and product-ID foreign keys are preserved.

If duplicate codes already exist within one type, the script reports them and rolls back. It also stops if a global item-code key is a primary key, is filtered, or is referenced by a foreign key, so a database administrator can review those dependencies rather than dropping them automatically. Other keys and indexes are left unchanged. The script can be rerun after a successful upgrade. Rebuild and restart the updated app afterward. Merely updating the code or changing a product name does not remove the old global database restriction. This schema upgrade is manual; `npm run check:db` only checks expected columns.

### Optional material lots and separate receiving MAK Release Number upgrade

**Material lot number is optional for both receiving and usage.** Receiving also has a separate optional **MAK Release Number**. Usage still requires its **MAK lot number**. All three reference fields accept up to 255 characters, are trimmed when saved, and remain independent. Blank optional values are stored as SQL `NULL`. Product stock validation is unchanged.

For installations that do not yet have a separate receiving reference field, stop the app, back up the database, and run [scripts/optional-material-lots.sql](./scripts/optional-material-lots.sql) as a database administrator in SQL Server Management Studio against the existing inventory database. It makes both material-lot fields nullable and removes the earlier required-usage-material-lot constraint. On the first run, it preserves legacy receiving references in an intermediate `mak_rn_number` column and clears the old material-lot column for actual optional lots. Then run the release-number rename below. The copy is skipped if either the intermediate or final release column already exists, so reruns cannot move newly entered material lots. Usage material lots, IDs, dates, quantities, and balances are preserved. Oversized values stop the script rather than being truncated; all changes roll back on failure.

This supersedes [scripts/usage-material-lot-required.sql](./scripts/usage-material-lot-required.sql); **do not run that historical script for the current app**, even on a new installation.

### MAK Release Number rename

For installations already using the separate receiving reference, only [scripts/mak-release-number.sql](./scripts/mak-release-number.sql) is needed. With the app stopped and a verified current backup available, run it against the existing inventory database. It renames `dbo.receiving_transactions.mak_rn_number` to `mak_release_number` using `sp_rename`. It does not rewrite stored identifiers, including existing `RN` prefixes, or change NULLs, material lots, quantities, IDs, or balances. The guarded transaction can be rerun after success; it stops if both/neither reference columns exist or SQL-object dependencies require review. No new columns are added by the rename itself.

Deploy the updated frontend and backend together after the migration, then restart and run `npm run check:db`. Receiving now sends/returns `makReleaseNumber` for **MAK Release Number** and `materialLotNumber` for actual material lots. Cached receiving forms posting the old `makRnNumber` property are accepted as a compatibility input only when the new property is absent, so their reference is not silently lost. Responses use the new property; refresh the browser to update labels and exports. The server requires the renamed column and performs no automatic migrations.

## Inventory behavior

- Product Master saves Item Code, MAK Item Code, Comment, and Unit (Pcs or kgs). The same name and Item Code can be reused across product types; only duplicate Item Codes within the same type are rejected. Product names do not get an automatic suffix. The catalog heading shows the total number of product records across all types, independent of search results; separate records count separately even when their names or codes match. This count uses existing product data and needs no database change.
- Product Master has an **All product types** / individual-type filter that combines with search across product names and both item codes. The total products count stays based on the entire catalog. Inventory History has the same type choices to narrow its product picker. Product options display **MAK Item Code · Item Code — Product Name (Product Type)**, using a dash when the MAK Item Code is missing. Changing to a type that excludes the selected product clears that selection and its displayed history. History type filters and product selection are preserved in the URL. These filters do not alter stored products or inventory.
- Stock is calculated from receiving minus usage transactions.
- Receiving has independent optional **MAK Release Number** (`makReleaseNumber` / `mak_release_number`) and **Material lot number** (`materialLotNumber` / `material_lot_number`) fields. Usage material lot is optional; its MAK lot number remains required. History tables retain four aligned columns and show a supplied material lot below the release/MAK lot reference. Missing optional references display a dash.
- Receiving and usage require selecting a **Product type** before choosing a product. The product list shows only items in that type, ordered in each option as **MAK Item Code · Item Code — Product Name (Product Type)**, followed by the available balance and unit. Missing MAK Item Codes display a dash, as in Inventory History. Changing the type clears the selected product; types with no items cannot be submitted. A successful save clears transaction details. Normal entry resets the product selections; opening from an Inventory History shortcut keeps the current product/type selected for repeated entries. Inventory History shows **Receiving** and **Usage** buttons once a valid product is selected. They open a dialog on the same page, with the product fixed to the selected history item and its codes/type/balance shown. Dialogs use the same transaction fields and backend validation as the standalone pages. A successful save closes the dialog and refreshes the selected history, balance, and catalog without changing the URL or selected product. Save errors keep the dialog and entered values open; a catalog/history refresh failure after a successful save must not be retried as a new transaction. Cancel, Close, Escape, or a backdrop click dismiss an idle dialog without saving; dismissal and repeated submissions are blocked while saving, keyboard focus stays in the dialog and returns to the trigger when closed. Existing `/receiving?productId=<id>` and `/usage?productId=<id>` deep links still work with the product/type preselected, including when data loads later. Changing the product/type remains possible on those standalone pages. This uses the existing product type relationship (`products.product_type_id`); no additional database migration is needed.
- Receiving, Usage, and Inventory History product dropdowns always use **MAK Item Code (A–Z)** ordering; there is no sort selector. Ordering is case-insensitive and natural (for example, `MAK2` precedes `MAK10`), and missing MAK codes stay last. Product type filters still apply. Sorting does not change stored records, transaction order, exports, or saved payloads; no database change is needed.
- Receiving and usage acquire a SQL Server update lock on the product within a transaction to coordinate concurrent requests.
- Material lot numbers are optional free-text references and do not need to match a receiving reference or another field. Usage quantities cannot exceed the product's available balance; material-lot balances are not checked.
- Dashboard shows one summary tile per product type (five tiles across on desktop for the current five types), with the type heading followed by **Total received**, **Total used**, and **Current balance**. Tiles aggregate the full catalog and do not change when searching or filtering the table. Types without products show zeros; new types get additional tiles rather than being omitted. Different units are totaled separately (`kg`/`kgs` normalize to `kgs`, `pcs` to `Pcs`) instead of mixing pieces and weight. Tiles refresh with catalog updates after transactions; no schema change is needed. On smaller screens, tiles wrap into two columns and then one.
- Dashboard **Export Excel** downloads `mak-inventory-summary.xlsx` with **one worksheet per product type registered in the system**, including types with no products. New and renamed types are reflected automatically; types are grouped by their IDs, not a hardcoded Sleeve/IFC/Bulk list or name aliases. Empty types retain header-only sheets. Worksheet names use the configured type names, sanitized/truncated with unique suffixes where Excel requires it. Products whose type metadata is unavailable are still included using their reported type (or Other); an entirely empty system exports a single header-only Inventory sheet. Each sheet contains **Product Name, Item Code, MAK Item Code, Total Received, Total Used, Available**, in that order. Headers are frozen and filterable, codes stay as text (including leading zeros), and quantities remain numeric and right-aligned. **Zero quantities display as blank cells while remaining numeric zero for calculations.** Whole quantities use thousands separators without decimal points (for example `100,000`, not `100,000.`); fractional quantities show up to three decimal places without unnecessary trailing zeros. These display formats apply only to the dashboard workbook and do not change saved inventory or the history workbook. Dashboard search/type filters do not limit the export; it uses all inventory products and all registered types. Excel generation loads only when exporting. No database changes are needed.
- Dashboard **Export Excel** opens an export menu. **All product types** keeps the stock-summary workbook above. Each registered type (Bulk, IFC, Label, and any newly added types) is also an option: selecting a type exports **all its products**, regardless of dashboard filters, into `inventory-history-<type-name>.xlsx`, with **one sheet per product** named from its MAK Item Code (falling back to Item Code/name/ID, with safe unique suffixes for repeated or invalid worksheet names). Each sheet has **Date, MAK Release Number, Item/Description, Qty, Used Qty, Used Against(MAK Lot No)**, chronological receiving/usage rows, real dates, literal codes, optional transaction notes, and a green **Closing balance** row calculated from that product’s ledger. Whole quantities use comma grouping without decimal points, fractional quantities retain up to three decimal places, and unused quantity cells stay blank. The closing zero balance remains visible. Products without transactions still get a sheet; an empty type gets an informative sheet instead of an invalid empty workbook. Export is disabled while generating; failures do not download a partial workbook. A read-only authenticated `/api/product-types/:id/history` endpoint fetches all products and transactions for the chosen type using a fixed number of queries, keeping otherwise-identical products isolated by ID. Deploy/restart the updated backend as well as the frontend for this new endpoint; no database migration is required. Existing single-product History Excel/PDF exports are unchanged.
- For an individual product, Inventory History **Export Excel** downloads `inventory-history-<item-code>.xlsx`. Its single **Product History** worksheet matches the ledger layout **Date, Item/Description, Qty, Used Qty, Used Against(MAK Lot No)**. Receiving rows show the product description and received quantity in bold; usage rows show consumed quantity and the MAK lot number with a single `#` prefix (for example `#M12345`) in red. Existing `#` or legacy `Lot #` prefixes are normalized for display only; stored lot identifiers and leading zeros remain unchanged. All transactions retain their actual dates and are ordered oldest first; same-day receipts precede usage. Dates are real Excel dates displayed as `m/d/yy`, and quantities remain numeric and right-aligned. MAK Release Numbers, optional material lot numbers, and transaction remarks are retained as cell notes; item codes and units are noted in the headers. No stock values are changed or inferred from font color. Empty histories export a header-only sheet.
- Inventory History also offers **Export PDF** beside Export Excel for the selected product. The landscape PDF has six columns in order: **Date, MAK Release Number, Item/Description, Qty, Used Qty, Used Against(MAK Lot No)**. MAK Release Number contains the receiving MAK Release Number, retaining leading zeros; usage rows leave it blank. Receiving rows stay bold, and usage quantities/MAK lots remain red with a single `#` prefix. A green **Closing balance** row appears once below the ledger on its final page, calculated as the printed received quantities minus used quantities and displayed with the product unit (up to three decimal places). Product name, item codes, type, and unit appear above the ledger. The static company header is **MAK Pharma USA**, **8 Middlebury Blvd, Randolph, NJ - 07869**, **makpharmausa.com**; these details are defined in [product-history-pdf.js](./src/lib/product-history-pdf.js). No logo is included until the company logo is supplied. Company/report/table headers repeat on every page, with page numbers in the footer. **Transaction Notes are not included in the PDF**; remarks and optional material lots remain stored and continue to appear in the unchanged Excel notes. PDF generation runs locally in the browser and its libraries load only when PDF export is selected. Both export buttons are disabled while a download is generated and become available again after success or failure. This PDF layout update requires no database change.
- Product Master retains its existing CSV download action.

## Validation

```powershell
npm test
npm run build
npm run check:db
```

Tests cover API behavior with a stubbed database, connection configuration, mandatory encryption, schema checking without object creation, and usage guards. `check:db` performs read-only checks against the actual server; it does not add test records. No database server is installed or created by these commands.
