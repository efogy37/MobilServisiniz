/* ==========================================================================
   OtoServis — "Tedarikçiye de öde" ile fazla müşteri tahsilatını düzelt
   --------------------------------------------------------------------------
   Senaryo: Müşteri tahsilatı kalan borcun tamamına (örn. 22850) yazılmış,
   bağlı tedarikçi ödemesi alış borcu kadar (örn. 20000) kalmış.
   Bu script: pid: ile bağlı ödemelerde müşteri tutarını tedarikçi tutarına
   çeker (müşteri > tedarikçi ise). Tedarikçi tutarına dokunmaz.

   Güvenli: yalnızca type=odeme + description içinde pid:{paymentId} olanlar.
   Önce SELECT önizleme, sonra UPDATE.
   Sunucuda çalıştırın (SSMS / sqlcmd -I).
   ========================================================================== */
USE OtoServis;
GO
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO

PRINT N'--- Önizleme (düzeltilecek tahsilatlar) ---';
SELECT
    p.id AS payment_id,
    p.amount AS customer_amount,
    st.amount AS supplier_amount,
    (p.amount - st.amount) AS excess,
    v.plate,
    c.full_name AS customer_name,
    s.full_name AS supplier_name,
    p.paid_at,
    LEFT(st.description, 160) AS supplier_desc
FROM dbo.payments p
INNER JOIN dbo.work_orders wo ON wo.id = p.work_order_id
INNER JOIN dbo.vehicles v ON v.id = wo.vehicle_id
INNER JOIN dbo.customers c ON c.id = wo.customer_id
INNER JOIN dbo.supplier_transactions st
    ON st.shop_id = p.shop_id
   AND st.type = N'odeme'
   AND st.description LIKE N'%' + N'pid:' + CONVERT(nvarchar(36), p.id) + N'%'
INNER JOIN dbo.customers s ON s.id = st.supplier_id
WHERE p.amount > st.amount + 0.009;
GO

BEGIN TRAN;

UPDATE p
SET p.amount = st.amount
FROM dbo.payments p
INNER JOIN dbo.supplier_transactions st
    ON st.shop_id = p.shop_id
   AND st.type = N'odeme'
   AND st.description LIKE N'%' + N'pid:' + CONVERT(nvarchar(36), p.id) + N'%'
WHERE p.amount > st.amount + 0.009;

DECLARE @n int = @@ROWCOUNT;
PRINT CONCAT(N'Düzeltilen tahsilat sayısı: ', @n);

-- Fazla tahsilat düzelince kalan > 0 olan "ödeme tamamlandı" işlerini geri al
UPDATE wo
SET wo.status = N'tamamlandi',
    wo.updated_at = SYSUTCDATETIME()
FROM dbo.work_orders wo
INNER JOIN dbo.vw_WorkOrderTotals t ON t.id = wo.id
WHERE wo.status = N'odeme_tamamlandi'
  AND ROUND(t.grand_total - t.paid_total, 2) > 0;

PRINT CONCAT(N'Status geri alınan iş emri: ', @@ROWCOUNT);

COMMIT TRAN;
PRINT N'Tamam. Müşteri tahsilatları bağlı tedarikçi tutarına çekildi.';
GO
