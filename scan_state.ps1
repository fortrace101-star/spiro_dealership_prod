# Scan for temp files
Write-Output "=== TEMP FILES ==="
Get-ChildItem 'c:/Users/manue/Desktop/spiro' -Force -Recurse -Include 'fix_*.js','fix_*.cjs','*.patch','*.bak','*.tmp' | Select-Object FullName,Mode
Write-Output ""

# All tables in schema
Write-Output "=== ALL CREATE TABLEs in schema.sql ==="
Select-String -Path 'c:/Users/manue/Desktop/spiro/server/src/db/schema.sql' -Pattern 'CREATE TABLE' | Select-Object LineNumber,Line
Write-Output ""

# Purchasing service - supplier/snapshot handling
Write-Output "=== purchasing.js SERVICE - supplier/snapshot ==="
Select-String -Path 'c:/Users/manue/Desktop/spiro/server/src/services/purchasing.js' -Pattern 'supplier|snapshot|tag' -Context 0,2
Write-Output ""

# Purchasing routes - nextRef/nextReorderRef
Write-Output "=== purchasing.js ROUTES - nextRef/nextReorderRef ==="
Select-String -Path 'c:/Users/manue/Desktop/spiro/server/src/routes/purchasing.js' -Pattern 'nextRef|nextReorderRef|supplier' -Context 0,2
Write-Output ""

# Reports route - supplier/expense
Write-Output "=== reports.js - supplier/expense ==="
Select-String -Path 'c:/Users/manue/Desktop/spiro/server/src/routes/reports.js' -Pattern 'supplier|expense' -Context 0,2
Write-Output ""

# Admin routes - expense/setup/recovery
Write-Output "=== admin.js ROUTES - expense/setup/recovery ==="
Select-String -Path 'c:/Users/manue/Desktop/spiro/server/src/routes/admin.js' -Pattern 'expense|setup|recovery' -Context 0,2
Write-Output ""

# Auth.js - setup/recovery
Write-Output "=== auth.js - setup/recovery ==="
Select-String -Path 'c:/Users/manue/Desktop/spiro/server/src/auth.js' -Pattern 'setup|recovery|first' -Context 0,2
Write-Output ""

# Auth routes - setup/recovery
Write-Output "=== routes/auth.js - setup/recovery ==="
Select-String -Path 'c:/Users/manue/Desktop/spiro/server/src/routes/auth.js' -Pattern 'setup|recovery|first|activate' -Context 0,2
Write-Output ""

# POS api - expense/nextReorder/suppliers
Write-Output "=== pos/src/lib/api.ts - expense/nextReorder/suppliers ==="
Select-String -Path 'c:/Users/manue/Desktop/spiro/pos/src/lib/api.ts' -Pattern 'expense|nextReorder|suppliers' -Context 0,2
Write-Output ""

# Admin api - expense/setup/recovery/counts
Write-Output "=== admin/src/lib/api.ts - expense/setup/recovery/counts ==="
Select-String -Path 'c:/Users/manue/Desktop/spiro/admin/src/lib/api.ts' -Pattern 'expense|setup|recovery|counts$' -Context 0,2
Write-Output ""

# Layout - reorderCount/expenses
Write-Output "=== Layout.tsx - reorderCount/expenses ==="
Select-String -Path 'c:/Users/manue/Desktop/spiro/admin/src/components/Layout.tsx' -Pattern 'reorderCount|expens' -Context 0,2
Write-Output ""

# Admin pages - Expenses/Setup/Recovery
Write-Output "=== Admin pages - Expenses/Setup/Recovery ==="
Get-ChildItem 'c:/Users/manue/Desktop/spiro/admin/src/pages' -Filter '*.tsx' | ForEach-Object {
    $file = $_.FullName
    $name = $_.Name
    $content = Get-Content $file -Raw
    if ($content -match 'Expenses|Setup|Recovery') {
        Write-Output "$($name): HAS_ONE_OF_THEM"
        Select-String -Path $file -Pattern 'Expenses|Setup|Recovery' -Context 0,1
    }
}
Write-Output ""

# Overview - polling
Write-Output "=== OverviewPage - polling ==="
Select-String -Path 'c:/Users/manue/Desktop/spiro/admin/src/pages/OverviewPage.tsx' -Pattern 'poll|setInterval|refresh|2000|load\(' -Context 0,1
Write-Output ""

# Permissions - inventory_entry
Write-Output "=== permissions.js - inventory_entry ==="
Select-String -Path 'c:/Users/manue/Desktop/spiro/server/src/middleware/permissions.js' -Pattern 'inventory_entry' -Context 0,2
Write-Output ""
