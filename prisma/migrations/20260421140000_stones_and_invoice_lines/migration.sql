-- AlterTable
ALTER TABLE "Asset" ADD COLUMN "publicUrl" TEXT;

-- AlterTable
ALTER TABLE "StoneAssignment" ADD COLUMN "itemCategory" TEXT;
ALTER TABLE "StoneAssignment" ADD COLUMN "colorGrade" TEXT;
ALTER TABLE "StoneAssignment" ADD COLUMN "clarityGrade" TEXT;
ALTER TABLE "StoneAssignment" ADD COLUMN "sourcing" TEXT;
ALTER TABLE "StoneAssignment" ADD COLUMN "certificateNumber" TEXT;
ALTER TABLE "StoneAssignment" ADD COLUMN "certificateLab" TEXT;

-- CreateTable
CREATE TABLE "VendorInvoiceLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorInvoiceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "metalOrKarat" TEXT,
    "weightGrams" REAL,
    "weightDwt" REAL,
    "quantity" INTEGER,
    "lineTotalCents" INTEGER,
    "notes" TEXT,
    CONSTRAINT "VendorInvoiceLine_vendorInvoiceId_fkey" FOREIGN KEY ("vendorInvoiceId") REFERENCES "VendorInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "VendorInvoiceLine_vendorInvoiceId_idx" ON "VendorInvoiceLine"("vendorInvoiceId");
