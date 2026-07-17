-- VSK Gas Ops — initial schema
-- Translated from the prototype's state shape (see docs/vsk-ops-production-plan.md §3).
-- Managed by DbUp: this script runs once and is journaled in dbo.SchemaVersions.

CREATE TABLE Drivers (
    Id        INT IDENTITY(1,1) PRIMARY KEY,
    Name      NVARCHAR(200) NOT NULL,
    Phone     NVARCHAR(30)  NULL,
    License   NVARCHAR(60)  NULL,
    CreatedAt DATETIME2     NOT NULL CONSTRAINT DF_Drivers_CreatedAt DEFAULT SYSUTCDATETIME()
);

CREATE TABLE Trucks (
    Id        INT IDENTITY(1,1) PRIMARY KEY,
    RegNo     NVARCHAR(30) NOT NULL,
    Capacity  INT          NULL,
    DriverId  INT          NULL CONSTRAINT FK_Trucks_Drivers REFERENCES Drivers(Id),
    CreatedAt DATETIME2    NOT NULL CONSTRAINT DF_Trucks_CreatedAt DEFAULT SYSUTCDATETIME()
);

CREATE TABLE Vendors (
    Id        INT IDENTITY(1,1) PRIMARY KEY,
    Name      NVARCHAR(200) NOT NULL,
    Phone     NVARCHAR(30)  NULL,
    Address   NVARCHAR(400) NULL,
    CreatedAt DATETIME2     NOT NULL CONSTRAINT DF_Vendors_CreatedAt DEFAULT SYSUTCDATETIME()
);

CREATE TABLE CylinderTypes (
    Id         INT IDENTITY(1,1) PRIMARY KEY,
    Name       NVARCHAR(100) NOT NULL,
    Weight     DECIMAL(6,2)  NOT NULL,
    -- What a customer pays to keep/own an empty cylinder instead of returning it
    EmptyPrice DECIMAL(12,2) NULL
);

CREATE TABLE Customers (
    Id                           INT IDENTITY(1,1) PRIMARY KEY,
    Name                         NVARCHAR(200) NOT NULL,
    Phone                        NVARCHAR(30)  NULL,
    Address                      NVARCHAR(400) NULL,
    Lat                          FLOAT         NULL,
    Lng                          FLOAT         NULL,
    -- Balances carried over from before this system was used
    OpeningBalance               DECIMAL(12,2) NOT NULL CONSTRAINT DF_Customers_OpeningBalance DEFAULT 0,
    OpeningEmptiesCylinderTypeId INT           NULL CONSTRAINT FK_Customers_OpeningEmptiesType REFERENCES CylinderTypes(Id),
    OpeningEmptiesQty            INT           NOT NULL CONSTRAINT DF_Customers_OpeningEmptiesQty DEFAULT 0
);

CREATE TABLE Users (
    Id           INT IDENTITY(1,1) PRIMARY KEY,
    Name         NVARCHAR(200) NOT NULL,
    Email        NVARCHAR(256) NOT NULL CONSTRAINT UQ_Users_Email UNIQUE,
    PasswordHash NVARCHAR(500) NOT NULL,
    Role         NVARCHAR(20)  NOT NULL CONSTRAINT CK_Users_Role CHECK (Role IN ('Owner','Dispatch','Accountant','Driver')),
    DriverId     INT           NULL CONSTRAINT FK_Users_Drivers REFERENCES Drivers(Id),
    CreatedAt    DATETIME2     NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME()
);

-- MRP is fixed per cylinder type, the same for every customer; changes are appended with an effective date
CREATE TABLE MrpHistory (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    CylinderTypeId INT           NOT NULL CONSTRAINT FK_MrpHistory_CylinderTypes REFERENCES CylinderTypes(Id),
    Value          DECIMAL(12,2) NOT NULL,
    EffectiveFrom  DATE          NOT NULL,
    ChangedAt      DATETIME2     NOT NULL CONSTRAINT DF_MrpHistory_ChangedAt DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_MrpHistory_Type_EffectiveFrom ON MrpHistory (CylinderTypeId, EffectiveFrom DESC);

-- Per-customer ₹-off-MRP discounts, valid within a date window
CREATE TABLE Discounts (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    CustomerId     INT           NOT NULL CONSTRAINT FK_Discounts_Customers REFERENCES Customers(Id),
    CylinderTypeId INT           NOT NULL CONSTRAINT FK_Discounts_CylinderTypes REFERENCES CylinderTypes(Id),
    Amount         DECIMAL(12,2) NOT NULL,
    StartDate      DATE          NOT NULL,
    EndDate        DATE          NOT NULL
);
CREATE INDEX IX_Discounts_Customer_Type ON Discounts (CustomerId, CylinderTypeId);

CREATE TABLE Trips (
    Id        INT IDENTITY(1,1) PRIMARY KEY,
    DriverId  INT       NOT NULL CONSTRAINT FK_Trips_Drivers REFERENCES Drivers(Id),
    TruckId   INT       NOT NULL CONSTRAINT FK_Trips_Trucks REFERENCES Trucks(Id),
    Stage     TINYINT   NOT NULL CONSTRAINT DF_Trips_Stage DEFAULT 0, -- 0 Assigned, 1 On Delivery Run, 2 Completed
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_Trips_CreatedAt DEFAULT SYSUTCDATETIME()
);

CREATE TABLE Orders (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    CustomerId  INT           NOT NULL CONSTRAINT FK_Orders_Customers REFERENCES Customers(Id),
    OrderDate   DATE          NOT NULL,
    Stage       TINYINT       NOT NULL CONSTRAINT DF_Orders_Stage DEFAULT 0, -- 0 Placed, 1 Approved, 2 In Trip, 3 Delivered
    Rejected    BIT           NOT NULL CONSTRAINT DF_Orders_Rejected DEFAULT 0,
    ApprovedBy  NVARCHAR(50)  NULL,
    TripId      INT           NULL CONSTRAINT FK_Orders_Trips REFERENCES Trips(Id),
    Amount      DECIMAL(12,2) NOT NULL CONSTRAINT DF_Orders_Amount DEFAULT 0,
    CreatedAt   DATETIME2     NOT NULL CONSTRAINT DF_Orders_CreatedAt DEFAULT SYSUTCDATETIME(),
    DeliveredAt DATETIME2     NULL
);
CREATE INDEX IX_Orders_Customer ON Orders (CustomerId);
CREATE INDEX IX_Orders_OrderDate ON Orders (OrderDate);
CREATE INDEX IX_Orders_DeliveredAt ON Orders (DeliveredAt) WHERE DeliveredAt IS NOT NULL;

CREATE TABLE OrderItems (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    OrderId        INT           NOT NULL CONSTRAINT FK_OrderItems_Orders REFERENCES Orders(Id) ON DELETE CASCADE,
    CylinderTypeId INT           NOT NULL CONSTRAINT FK_OrderItems_CylinderTypes REFERENCES CylinderTypes(Id),
    OrderedQty     INT           NOT NULL, -- requested; Qty may be adjusted (+/-) at delivery
    Qty            INT           NOT NULL,
    Rate           DECIMAL(12,2) NOT NULL,
    Amount         DECIMAL(12,2) NOT NULL
);
CREATE INDEX IX_OrderItems_Order ON OrderItems (OrderId);

CREATE TABLE OrderPayments (
    Id        INT IDENTITY(1,1) PRIMARY KEY,
    OrderId   INT           NOT NULL CONSTRAINT FK_OrderPayments_Orders REFERENCES Orders(Id) ON DELETE CASCADE,
    Method    NVARCHAR(10)  NOT NULL CONSTRAINT CK_OrderPayments_Method CHECK (Method IN ('Cash','Online')),
    Amount    DECIMAL(12,2) NOT NULL,
    Timestamp DATETIME2     NOT NULL CONSTRAINT DF_OrderPayments_Timestamp DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_OrderPayments_Order ON OrderPayments (OrderId);
CREATE INDEX IX_OrderPayments_Timestamp ON OrderPayments (Timestamp);

-- Empties a customer bought outright (kept) instead of returning — billed on the same order
CREATE TABLE EmptyPurchases (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    OrderId        INT           NOT NULL CONSTRAINT FK_EmptyPurchases_Orders REFERENCES Orders(Id) ON DELETE CASCADE,
    CylinderTypeId INT           NOT NULL CONSTRAINT FK_EmptyPurchases_CylinderTypes REFERENCES CylinderTypes(Id),
    Qty            INT           NOT NULL,
    Price          DECIMAL(12,2) NOT NULL,
    Amount         DECIMAL(12,2) NOT NULL,
    Date           DATE          NOT NULL
);
CREATE INDEX IX_EmptyPurchases_Order ON EmptyPurchases (OrderId);
CREATE INDEX IX_EmptyPurchases_Date ON EmptyPurchases (Date);

CREATE TABLE TripStops (
    Id          INT       IDENTITY(1,1) PRIMARY KEY,
    TripId      INT       NOT NULL CONSTRAINT FK_TripStops_Trips REFERENCES Trips(Id) ON DELETE CASCADE,
    OrderId     INT       NOT NULL CONSTRAINT FK_TripStops_Orders REFERENCES Orders(Id),
    Seq         INT       NOT NULL, -- position in the optimized route, 1-based
    Lat         FLOAT     NOT NULL,
    Lng         FLOAT     NOT NULL,
    DistanceKm  FLOAT     NOT NULL, -- leg distance from the previous stop (or depot)
    EtaMin      INT       NOT NULL, -- cumulative ETA from departure at ~28 km/h
    Delivered   BIT       NOT NULL CONSTRAINT DF_TripStops_Delivered DEFAULT 0,
    DeliveredAt DATETIME2 NULL
);
CREATE INDEX IX_TripStops_Trip ON TripStops (TripId);

-- Per-cylinder-type reconciliation recorded when a stop is delivered (full/empty/defect/bought at the door)
CREATE TABLE TripStopItems (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    TripStopId     INT NOT NULL CONSTRAINT FK_TripStopItems_TripStops REFERENCES TripStops(Id) ON DELETE CASCADE,
    CylinderTypeId INT NOT NULL CONSTRAINT FK_TripStopItems_CylinderTypes REFERENCES CylinderTypes(Id),
    OrderedQty     INT NOT NULL,
    ActualQty      INT NOT NULL,
    FullQty        INT NOT NULL,
    EmptyQty       INT NOT NULL,
    DefectQty      INT NOT NULL,
    BuyQty         INT NOT NULL
);

-- Cylinder movement journal: every fill / empty return / defect / empty purchase, per customer per type per day.
-- This is the source of truth for the reporting pages and for "empties at customer" balances.
CREATE TABLE Events (
    Id             INT          IDENTITY(1,1) PRIMARY KEY,
    Date           DATE         NOT NULL,
    CustomerId     INT          NOT NULL CONSTRAINT FK_Events_Customers REFERENCES Customers(Id),
    CylinderTypeId INT          NOT NULL CONSTRAINT FK_Events_CylinderTypes REFERENCES CylinderTypes(Id),
    Action         NVARCHAR(20) NOT NULL CONSTRAINT CK_Events_Action CHECK (Action IN ('filled','empty_return','defect','empty_purchased')),
    Qty            INT          NOT NULL,
    CreatedAt      DATETIME2    NOT NULL CONSTRAINT DF_Events_CreatedAt DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Events_Date ON Events (Date);
CREATE INDEX IX_Events_Customer_Type ON Events (CustomerId, CylinderTypeId);

-- Company's own depot stock, one record per cylinder type.
-- Full auto-deducts on trip departure; Empty/Defective auto-credit on delivery; manual edits are corrections.
CREATE TABLE Inventory (
    Id             INT       IDENTITY(1,1) PRIMARY KEY,
    CylinderTypeId INT       NOT NULL CONSTRAINT FK_Inventory_CylinderTypes REFERENCES CylinderTypes(Id),
    [Full]         INT       NOT NULL CONSTRAINT DF_Inventory_Full DEFAULT 0,
    Empty          INT       NOT NULL CONSTRAINT DF_Inventory_Empty DEFAULT 0,
    Defective      INT       NOT NULL CONSTRAINT DF_Inventory_Defective DEFAULT 0,
    UpdatedAt      DATETIME2 NOT NULL CONSTRAINT DF_Inventory_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_Inventory_CylinderType UNIQUE (CylinderTypeId)
);

-- Supplier relationship with IOCL: 'sent' ships empties/defectives out for refill,
-- 'received' brings full stock in with what the vendor billed — a running payable, not just stock counts.
CREATE TABLE IoclTransactions (
    Id             INT           IDENTITY(1,1) PRIMARY KEY,
    Type           NVARCHAR(10)  NOT NULL CONSTRAINT CK_IoclTransactions_Type CHECK (Type IN ('sent','received')),
    Date           DATE          NOT NULL,
    CylinderTypeId INT           NOT NULL CONSTRAINT FK_IoclTransactions_CylinderTypes REFERENCES CylinderTypes(Id),
    Qty            INT           NOT NULL,
    EmptyQty       INT           NOT NULL CONSTRAINT DF_IoclTransactions_EmptyQty DEFAULT 0,
    DefectiveQty   INT           NOT NULL CONSTRAINT DF_IoclTransactions_DefectiveQty DEFAULT 0,
    VendorId       INT           NULL CONSTRAINT FK_IoclTransactions_Vendors REFERENCES Vendors(Id),
    AmountBilled   DECIMAL(12,2) NOT NULL CONSTRAINT DF_IoclTransactions_AmountBilled DEFAULT 0,
    Paid           BIT           NOT NULL CONSTRAINT DF_IoclTransactions_Paid DEFAULT 0,
    PaidOn         DATE          NULL,
    Note           NVARCHAR(400) NULL,
    CreatedAt      DATETIME2     NOT NULL CONSTRAINT DF_IoclTransactions_CreatedAt DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_IoclTransactions_Date ON IoclTransactions (Date);

CREATE TABLE Notifications (
    Id        INT           IDENTITY(1,1) PRIMARY KEY,
    Audience  NVARCHAR(200) NOT NULL,
    Message   NVARCHAR(1000) NOT NULL,
    Timestamp DATETIME2     NOT NULL CONSTRAINT DF_Notifications_Timestamp DEFAULT SYSUTCDATETIME()
);

-- Audit trail replacing the prototype's per-order history array ("Placed", "Approved by SK", "Payment ₹X via Cash", …)
CREATE TABLE OrderHistory (
    Id        INT           IDENTITY(1,1) PRIMARY KEY,
    OrderId   INT           NOT NULL CONSTRAINT FK_OrderHistory_Orders REFERENCES Orders(Id) ON DELETE CASCADE,
    Stage     NVARCHAR(200) NOT NULL,
    Timestamp DATETIME2     NOT NULL CONSTRAINT DF_OrderHistory_Timestamp DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_OrderHistory_Order ON OrderHistory (OrderId);

CREATE TABLE TripHistory (
    Id        INT           IDENTITY(1,1) PRIMARY KEY,
    TripId    INT           NOT NULL CONSTRAINT FK_TripHistory_Trips REFERENCES Trips(Id) ON DELETE CASCADE,
    Stage     NVARCHAR(200) NOT NULL,
    Timestamp DATETIME2     NOT NULL CONSTRAINT DF_TripHistory_Timestamp DEFAULT SYSUTCDATETIME()
);

-- App-level settings (single row): depot location used for route planning
CREATE TABLE AppSettings (
    Id       INT   NOT NULL CONSTRAINT PK_AppSettings PRIMARY KEY CONSTRAINT CK_AppSettings_SingleRow CHECK (Id = 1),
    DepotLat FLOAT NOT NULL,
    DepotLng FLOAT NOT NULL
);
-- Placeholder — set to the actual IOCL bottling plant coordinates
INSERT INTO AppSettings (Id, DepotLat, DepotLng) VALUES (1, 17.4239, 78.4738);
