-- Run manually as a database administrator in the existing inventory database.
-- Back up the database first and stop the app before running this migration.
-- Transfers are immutable audit entries; balances are derived from source and destination product IDs.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'dbo.companies', N'U') IS NULL
       OR OBJECT_ID(N'dbo.products', N'U') IS NULL
       OR OBJECT_ID(N'dbo.app_users', N'U') IS NULL
        THROW 50001, 'Run the company workspace migration and ensure app_users exist first.', 1;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.products') AND name = N'UX_products_id_company')
        CREATE UNIQUE INDEX UX_products_id_company ON dbo.products (id, company_id);

    IF OBJECT_ID(N'dbo.inventory_transfers', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.inventory_transfers (
            id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_inventory_transfers PRIMARY KEY,
            company_id INT NOT NULL,
            source_product_id INT NOT NULL,
            destination_product_id INT NOT NULL,
            source_material_lot_number NVARCHAR(255) NULL,
            destination_mak_lot_number NVARCHAR(255) NOT NULL,
            transfer_date DATE NOT NULL,
            quantity FLOAT NOT NULL,
            added_by_user_id INT NOT NULL,
            created_at DATETIME2(3) NOT NULL CONSTRAINT DF_inventory_transfers_created_at DEFAULT (SYSUTCDATETIME()),
            CONSTRAINT CK_inventory_transfers_different_products CHECK (source_product_id <> destination_product_id),
            CONSTRAINT CK_inventory_transfers_positive_quantity CHECK (quantity > 0),
            CONSTRAINT FK_inventory_transfers_company FOREIGN KEY (company_id) REFERENCES dbo.companies(id),
            CONSTRAINT FK_inventory_transfers_source FOREIGN KEY (source_product_id, company_id) REFERENCES dbo.products(id, company_id),
            CONSTRAINT FK_inventory_transfers_destination FOREIGN KEY (destination_product_id, company_id) REFERENCES dbo.products(id, company_id),
            CONSTRAINT FK_inventory_transfers_user FOREIGN KEY (added_by_user_id) REFERENCES dbo.app_users(id)
        );
        CREATE INDEX IX_inventory_transfers_source ON dbo.inventory_transfers(company_id, source_product_id, transfer_date, id);
        CREATE INDEX IX_inventory_transfers_destination ON dbo.inventory_transfers(company_id, destination_product_id, transfer_date, id);
    END;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
