import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export interface TableColumn<Row> {
  readonly key?: string;
  readonly title: ReactNode;
  readonly dataIndex?: keyof Row;
  // Method syntax on purpose: callers annotate `value` with the column's own
  // type (a status, a name), which is only assignable under bivariance.
  render?(value: Row[keyof Row], row: Row, index: number): ReactNode;
  readonly width?: number | string;
}

export interface TableProps<Row> extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  readonly rowKey: keyof Row | ((row: Row) => string);
  readonly columns: readonly TableColumn<Row>[];
  readonly dataSource: readonly Row[];
  readonly emptyText?: ReactNode;
  readonly pagination?: false | { pageSize?: number; showSizeChanger?: boolean };
  readonly onRow?: (row: Row, index: number) => HTMLAttributes<HTMLTableRowElement>;
}

export function Table<Row>({ rowKey, columns, dataSource, emptyText = "No data", pagination, onRow, className, ...props }: TableProps<Row>) {
  const pageSize = pagination && pagination.pageSize ? pagination.pageSize : dataSource.length;
  const rows = dataSource.slice(0, pageSize);
  const keyFor = (row: Row) => String(typeof rowKey === "function" ? rowKey(row) : row[rowKey]);
  return (
    <div {...props} className={["ui-table-wrap", className].filter(Boolean).join(" ")}>
      <table className="ui-table">
        <thead><tr>{columns.map((column, index) => <th key={column.key ?? String(column.dataIndex ?? index)} style={{ width: column.width as CSSProperties["width"] }}>{column.title}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((row, rowIndex) => (
            <tr key={keyFor(row)} {...onRow?.(row, rowIndex)}>
              {columns.map((column, columnIndex) => {
                const value = column.dataIndex == null ? undefined : row[column.dataIndex];
                return <td key={column.key ?? String(column.dataIndex ?? columnIndex)}>{column.render ? column.render(value as Row[keyof Row], row, rowIndex) : value as ReactNode}</td>;
              })}
            </tr>
          )) : <tr><td colSpan={Math.max(1, columns.length)}><div className="ui-table__empty">{emptyText}</div></td></tr>}
        </tbody>
      </table>
    </div>
  );
}
