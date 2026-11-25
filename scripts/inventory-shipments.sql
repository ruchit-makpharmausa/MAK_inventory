-- Run manually as a database administrator in the existing inventory database.
-- Back up the database first and stop the app before running this migration.
-- Shipment rows are an audit log only; shipped_product_id does not receive inventory.
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'dbo.companies', N'U') IS NULL
       OR OBJECT_ID(N'dbo.products', N'U') IS NULL
       OR OBJECT_ID(N'dbo.app_users', N'U') IS NULL
        THROW 50001, 'Run the company workspace migration and ensure app_users exist first.', 1;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.products') AND name = N'UX_products_id_company')
        CREATE UNIQUE INDEX UX_products_id_company ON dbo.products (id, company_id);

    IF OBJECT_ID(N'dbo.inventory_shipments', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.inventory_shipments (
            id INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_inventory_shipments PRIMARY KEY,
            company_id INT NOT NULL,
            finished_product_id INT NOT NULL,
            shipped_product_id INT NOT NULL,
            shipment_date DATE NOT NULL,
            quantity FLOAT NOT NULL,
            source_material_lot_number NVARCHAR(255) NULL,
            added_by_user_id INT NOT NULL,
            created_at DATETIME2(3) NOT NULL CONSTRAINT DF_inventory_shipments_created_at DEFAULT (SYSUTCDATETIME()),
            CONSTRAINT CK_inventory_shipments_positive_quantity CHECK (quantity > 0),
            CONSTRAINT CK_inventory_shipments_different_products CHECK (finished_product_id <> shipped_product_id),
            CONSTRAINT FK_inventory_shipments_company FOREIGN KEY (company_id) REFERENCES dbo.companies(id),
            CONSTRAINT FK_inventory_shipments_finished_product FOREIGN KEY (finished_product_id, company_id) REFERENCES dbo.products(id, company_id),
            CONSTRAINT FK_inventory_shipments_shipped_product FOREIGN KEY (shipped_product_id, company_id) REFERENCES dbo.products(id, company_id),
            CONSTRAINT FK_inventory_shipments_user FOREIGN KEY (added_by_user_id) REFERENCES dbo.app_users(id)
        );
        CREATE INDEX IX_inventory_shipments_company_date ON dbo.inventory_shipments(company_id, shipment_date, id);
    END;

    IF COL_LENGTH(N'dbo.inventory_shipments', N'source_material_lot_number') IS NULL
        ALTER TABLE dbo.inventory_shipments ADD source_material_lot_number NVARCHAR(255) NULL;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
