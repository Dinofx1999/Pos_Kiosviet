ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_refunded_range" CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "total_refund");
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_amounts" CHECK ("subtotal" >= 0 AND "fee_amount" >= 0 AND "total_refund" >= 0 AND "fee_amount" <= "subtotal");
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_qty_positive" CHECK ("quantity" > 0 AND "base_quantity" > 0);
