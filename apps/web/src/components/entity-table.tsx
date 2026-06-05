import { Link } from '@tanstack/react-router';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface EntityColumn<T> {
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

interface EntityTableProps<T extends { id: string }> {
  columns: EntityColumn<T>[];
  rows: T[];
  rowHref: (row: T) => string;
  emptyMessage?: string;
}

/**
 * Generic table that links each row to a detail page. List pages use this
 * to render contacts/companies without duplicating layout.
 */
export function EntityTable<T extends { id: string }>({
  columns,
  rows,
  rowHref,
  emptyMessage,
}: EntityTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
        {emptyMessage ?? 'No items yet.'}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm [&_thead]:bg-slate-50/80">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead key={c.header} className={c.className}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className="cursor-pointer">
              {columns.map((c, i) => (
                <TableCell key={i} className={c.className}>
                  {i === 0 ? (
                    <Link
                      to={rowHref(row)}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {c.cell(row)}
                    </Link>
                  ) : (
                    c.cell(row)
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
