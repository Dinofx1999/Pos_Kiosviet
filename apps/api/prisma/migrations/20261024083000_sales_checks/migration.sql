-- Defense-in-depth CHECK constraints for POS documents
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_range" CHECK ("paid_amount" >= 0 AND "paid_amount" <= "total_amount");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_returned_range" CHECK ("returned_amount" >= 0 AND "returned_amount" <= "total_amount");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amounts_nonneg" CHECK ("subtotal" >= 0 AND "discount_amount" >= 0 AND "total_amount" >= 0 AND "cost_total" >= 0);
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_qty_positive" CHECK ("quantity" > 0 AND "base_quantity" > 0 AND "conversion_factor" > 0);
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_returned_range" CHECK ("returned_quantity" >= 0 AND "returned_quantity" <= "quantity");
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_opening_cash_nonneg" CHECK ("opening_cash" >= 0);
