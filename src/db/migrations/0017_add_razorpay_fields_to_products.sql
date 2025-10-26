-- Add Razorpay integration fields to products table
ALTER TABLE "products" ADD COLUMN "razorpay_plan_id" text;
ALTER TABLE "products" ADD COLUMN "popular" boolean DEFAULT false NOT NULL;

-- Make razorpay_plan_id required after we've added the column
-- (This allows existing products to be updated manually before making it required)
-- Uncomment the line below after you've set razorpay_plan_id for existing products:
-- ALTER TABLE "products" ALTER COLUMN "razorpay_plan_id" SET NOT NULL;