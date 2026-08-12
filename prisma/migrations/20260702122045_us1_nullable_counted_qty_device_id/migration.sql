-- AlterTable
ALTER TABLE "InventoryLine" ALTER COLUMN "countedQty" DROP NOT NULL;

-- AlterTable
ALTER TABLE "InventorySession" ALTER COLUMN "deviceId" DROP NOT NULL;
