import os
f = 'c:/Users/manue/Desktop/spiro/admin/src/pages/InventoryPage.tsx'
c = open(f, encoding='utf-8').read()

old_lines = [
  '<span',
  '                          title={p.stock_qty === 0 ? \'Out of stock\' : isLow ? `Low stock (reorder at ${p.reorder_level})` : \'In stock\'}',
  '                          className={cn(',
  "                            'inline-flex h-9 w-9 items-center justify-center rounded-full border font-bold text-xs',",
  "                            p.stock_qty === 0",
  "                              ? 'bg-red-500/15 text-red-400 border-red-500/50'",
  '                              : isLow',
  "                                ? 'bg-amber-500/15 text-amber-400 border-amber-500/50'",
  "                                : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',",
  '                          )}',
  '                        >',
  '                          {p.stock_qty}',
  '                        </span>',
]
new_lines = [
  '<span',
  '                          className={cn(',
  "                            'inline-flex items-center font-semibold text-xs',",
  "                            p.stock_qty === 0",
  "                              ? 'bg-red-500/15 text-red-400'",
  '                              : isLow',
  "                                ? 'bg-amber-500/15 text-amber-400'",
  "                                : 'bg-emerald-500/15 text-emerald-400',",
  '                          )}',
  '                        >',
  "                          {p.stock_qty === 0 ? 'Out' : isLow ? 'Low' : 'OK'}",
  '                        </span>',
]

old_str = chr(10).join(old_lines)
new_str = chr(10).join(new_lines)

if old_str in c:
    c = c.replace(old_str, new_str)
    open(f, 'w', encoding='utf-8').write(c)
    print('REPLACED')
else:
    print('NOT_FOUND')
    idx = c.find('className={cn(')
    print('Snippet around first className={cn(}:')
    print(c[idx:idx+500] if idx >= 0 else 'not found')
