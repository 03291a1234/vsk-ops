-- VSK Gas Ops — initial schema (PostgreSQL 13+)
-- Translated from the prototype's state shape (see docs/vsk-ops-production-plan.md §3).
-- Managed by DbUp: this script runs once and is journaled in public.schemaversions.
--
-- Note on identifiers: everything is unquoted (folds to lowercase) except "Full" on Inventory,
-- which must be quoted because FULL is a reserved word in PostgreSQL.

CREATE TABLE Drivers (
    Id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    Name      VARCHAR(200) NOT NULL,
    Phone     VARCHAR(30),
    License   VARCHAR(60),
    CreatedAt TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE Trucks (
    Id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    RegNo     VARCHAR(30) NOT NULL,
    Capacity  INT,
    DriverId  INT REFERENCES Drivers(Id),
    CreatedAt TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE Vendors (
    Id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    Name      VARCHAR(200) NOT NULL,
    Phone     VARCHAR(30),
    Address   VARCHAR(400),
    CreatedAt TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE CylinderTypes (
    Id         INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    Name       VARCHAR(100) NOT NULL,
    Weight     NUMERIC(6,2) NOT NULL,
    -- What a customer pays to keep/own an empty cylinder instead of returning it
    EmptyPrice NUMERIC(12,2)
);

CREATE TABLE Customers (
    Id                           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    Name                         VARCHAR(200) NOT NULL,
    Phone                        VARCHAR(30),
    Address                      VARCHAR(400),
    Lat                          DOUBLE PRECISION,
    Lng                          DOUBLE PRECISION,
    -- Balances carried over from before this system was used
    OpeningBalance               NUMERIC(12,2) NOT NULL DEFAULT 0,
    OpeningEmptiesCylinderTypeId INT REFERENCES CylinderTypes(Id),
    OpeningEmptiesQty            INT NOT NULL DEFAULT 0
);

CREATE TABLE Users (
    Id           INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    Name         VARCHAR(200) NOT NULL,
    Email        VARCHAR(256) NOT NULL UNIQUE,
    PasswordHash VARCHAR(500) NOT NULL,
    Role         VARCHAR(20)  NOT NULL CHECK (Role IN ('Owner','Dispatch','Accountant','Driver')),
    DriverId     INT REFERENCES Drivers(Id),
    CreatedAt    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- MRP is fixed per cylinder type, the same for every customer; changes are appended with an effective date
CREATE TABLE MrpHistory (
    Id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    CylinderTypeId INT NOT NULL REFERENCES CylinderTypes(Id),
    Value          NUMERIC(12,2) NOT NULL,
    EffectiveFrom  DATE NOT NULL,
    ChangedAt      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IX_MrpHistory_Type_EffectiveFrom ON MrpHistory (CylinderTypeId, EffectiveFrom DESC);

-- Per-customer ₹-off-MRP discounts, valid within a date window
CREATE TABLE Discounts (
    Id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    CustomerId     INT NOT NULL REFERENCES Customers(Id),
    CylinderTypeId INT NOT NULL REFERENCES CylinderTypes(Id),
    Amount         NUMERIC(12,2) NOT NULL,
    StartDate      DATE NOT NULL,
    EndDate        DATE NOT NULL
);
CREATE INDEX IX_Discounts_Customer_Type ON Discounts (CustomerId, CylinderTypeId);

CREATE TABLE Trips (
    Id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    DriverId  INT NOT NULL REFERENCES Drivers(Id),
    TruckId   INT NOT NULL REFERENCES Trucks(Id),
    Stage     INT NOT NULL DEFAULT 0, -- 0 Assigned, 1 On Delivery Run, 2 Completed
    CreatedAt TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE Orders (
    Id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    CustomerId  INT NOT NULL REFERENCES Customers(Id),
    OrderDate   DATE NOT NULL,
    Stage       INT NOT NULL DEFAULT 0, -- 0 Placed, 1 Approved, 2 In Trip, 3 Delivered
    Rejected    BOOLEAN NOT NULL DEFAULT FALSE,
    ApprovedBy  VARCHAR(50),
    TripId      INT REFERENCES Trips(Id),
    Amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    CreatedAt   TIMESTAMPTZ NOT NULL DEFAULT now(),
    DeliveredAt TIMESTAMPTZ
);
CREATE INDEX IX_Orders_Customer ON Orders (CustomerId);
CREATE INDEX IX_Orders_OrderDate ON Orders (OrderDate);
CREATE INDEX IX_Orders_DeliveredAt ON Orders (DeliveredAt) WHERE DeliveredAt IS NOT NULL;

CREATE TABLE OrderItems (
    Id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    OrderId        INT NOT NULL REFERENCES Orders(Id) ON DELETE CASCADE,
    CylinderTypeId INT NOT NULL REFERENCES CylinderTypes(Id),
    OrderedQty     INT NOT NULL, -- requested; Qty may be adjusted (+/-) at delivery
    Qty            INT NOT NULL,
    Rate           NUMERIC(12,2) NOT NULL,
    Amount         NUMERIC(12,2) NOT NULL
);
CREATE INDEX IX_OrderItems_Order ON OrderItems (OrderId);

CREATE TABLE OrderPayments (
    Id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    OrderId   INT NOT NULL REFERENCES Orders(Id) ON DELETE CASCADE,
    Method    VARCHAR(10) NOT NULL CHECK (Method IN ('Cash','Online')),
    Amount    NUMERIC(12,2) NOT NULL,
    Timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IX_OrderPayments_Order ON OrderPayments (OrderId);
CREATE INDEX IX_OrderPayments_Timestamp ON OrderPayments (Timestamp);

-- Empties a customer bought outright (kept) instead of returning — billed on the same order
CREATE TABLE EmptyPurchases (
    Id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    OrderId        INT NOT NULL REFERENCES Orders(Id) ON DELETE CASCADE,
    CylinderTypeId INT NOT NULL REFERENCES CylinderTypes(Id),
    Qty            INT NOT NULL,
    Price          NUMERIC(12,2) NOT NULL,
    Amount         NUMERIC(12,2) NOT NULL,
    Date           DATE NOT NULL
);
CREATE INDEX IX_EmptyPurchases_Order ON EmptyPurchases (OrderId);
CREATE INDEX IX_EmptyPurchases_Date ON EmptyPurchases (Date);

CREATE TABLE TripStops (
    Id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    TripId      INT NOT NULL REFERENCES Trips(Id) ON DELETE CASCADE,
    OrderId     INT NOT NULL REFERENCES Orders(Id),
    Seq         INT NOT NULL, -- position in the optimized route, 1-based
    Lat         DOUBLE PRECISION NOT NULL,
    Lng         DOUBLE PRECISION NOT NULL,
    DistanceKm  DOUBLE PRECISION NOT NULL, -- leg distance from the previous stop (or depot)
    EtaMin      INT NOT NULL, -- cumulative ETA from departure at ~28 km/h
    Delivered   BOOLEAN NOT NULL DEFAULT FALSE,
    DeliveredAt TIMESTAMPTZ
);
CREATE INDEX IX_TripStops_Trip ON TripStops (TripId);

-- Per-cylinder-type reconciliation recorded when a stop is delivered (full/empty/defect/bought at the door)
CREATE TABLE TripStopItems (
    Id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    TripStopId     INT NOT NULL REFERENCES TripStops(Id) ON DELETE CASCADE,
    CylinderTypeId INT NOT NULL REFERENCES CylinderTypes(Id),
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
    Id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    Date           DATE NOT NULL,
    CustomerId     INT NOT NULL REFERENCES Customers(Id),
    CylinderTypeId INT NOT NULL REFERENCES CylinderTypes(Id),
    Action         VARCHAR(20) NOT NULL CHECK (Action IN ('filled','empty_return','defect','empty_purchased')),
    Qty            INT NOT NULL,
    CreatedAt      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IX_Events_Date ON Events (Date);
CREATE INDEX IX_Events_Customer_Type ON Events (CustomerId, CylinderTypeId);

-- Company's own depot stock, one record per cylinder type.
-- Full auto-deducts on trip departure; Empty/Defective auto-credit on delivery; manual edits are corrections.
CREATE TABLE Inventory (
    Id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    CylinderTypeId INT NOT NULL REFERENCES CylinderTypes(Id) UNIQUE,
    "Full"         INT NOT NULL DEFAULT 0,
    Empty          INT NOT NULL DEFAULT 0,
    Defective      INT NOT NULL DEFAULT 0,
    UpdatedAt      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supplier relationship with IOCL: 'sent' ships empties/defectives out for refill,
-- 'received' brings full stock in with what the vendor billed — a running payable, not just stock counts.
CREATE TABLE IoclTransactions (
    Id             INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    Type           VARCHAR(10) NOT NULL CHECK (Type IN ('sent','received')),
    Date           DATE NOT NULL,
    CylinderTypeId INT NOT NULL REFERENCES CylinderTypes(Id),
    Qty            INT NOT NULL,
    EmptyQty       INT NOT NULL DEFAULT 0,
    DefectiveQty   INT NOT NULL DEFAULT 0,
    VendorId       INT REFERENCES Vendors(Id),
    AmountBilled   NUMERIC(12,2) NOT NULL DEFAULT 0,
    Paid           BOOLEAN NOT NULL DEFAULT FALSE,
    PaidOn         DATE,
    Note           VARCHAR(400),
    CreatedAt      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IX_IoclTransactions_Date ON IoclTransactions (Date);

CREATE TABLE Notifications (
    Id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    Audience  VARCHAR(200) NOT NULL,
    Message   VARCHAR(1000) NOT NULL,
    Timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit trail replacing the prototype's per-order history array ("Placed", "Approved by SK", "Payment ₹X via Cash", …)
CREATE TABLE OrderHistory (
    Id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    OrderId   INT NOT NULL REFERENCES Orders(Id) ON DELETE CASCADE,
    Stage     VARCHAR(200) NOT NULL,
    Timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IX_OrderHistory_Order ON OrderHistory (OrderId);

CREATE TABLE TripHistory (
    Id        INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    TripId    INT NOT NULL REFERENCES Trips(Id) ON DELETE CASCADE,
    Stage     VARCHAR(200) NOT NULL,
    Timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- App-level settings (single row): depot location used for route planning
CREATE TABLE AppSettings (
    Id       INT PRIMARY KEY CHECK (Id = 1),
    DepotLat DOUBLE PRECISION NOT NULL,
    DepotLng DOUBLE PRECISION NOT NULL
);
-- Placeholder — set to the actual IOCL bottling plant coordinates
INSERT INTO AppSettings (Id, DepotLat, DepotLng) VALUES (1, 17.4239, 78.4738);
