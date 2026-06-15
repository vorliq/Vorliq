// Reusable paginated table with optional inline row expansion. Built to back
// the Dashboard transaction history and to be reused for Mining block history,
// etc. Handles its own loading skeleton, inline error + retry, empty state, and
// pagination so each page that uses it stays small.
import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

import { InlineError, Skeleton } from "./primitives";

export default function DataTable({
  columns,
  rows,
  rowKey = (_row, i) => i,
  pageSize = 20,
  loading = false,
  error = "",
  onRetry,
  emptyMessage = "Nothing to show yet.",
  renderExpanded,
  caption,
}) {
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(null);

  const total = rows?.length || 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Keep the page in range if the data shrinks.
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  if (error) {
    return <InlineError message={error} onRetry={onRetry} />;
  }

  const start = page * pageSize;
  const pageRows = (rows || []).slice(start, start + pageSize);
  const colSpan = columns.length + (renderExpanded ? 1 : 0);

  return (
    <div className="vn-dt">
      <div className="vn-dt__scroll">
        <table className="vn-table" aria-label={caption}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={col.headerClassName}>
                  {col.header}
                </th>
              ))}
              {renderExpanded && <th aria-label="Expand" />}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => (
                <tr key={`skel-${i}`}>
                  {columns.map((col) => (
                    <td key={col.key}>
                      <Skeleton height={14} />
                    </td>
                  ))}
                  {renderExpanded && (
                    <td>
                      <Skeleton height={14} width={16} />
                    </td>
                  )}
                </tr>
              ))
            ) : total === 0 ? (
              <tr>
                <td colSpan={colSpan} className="vn-dt__empty">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pageRows.map((row, i) => {
                const key = rowKey(row, start + i);
                const isOpen = expanded === key;
                const clickable = Boolean(renderExpanded);
                return (
                  <Fragment key={key}>
                    <tr
                      className={`${clickable ? "vn-dt__row--clickable" : ""} ${isOpen ? "vn-dt__row--open" : ""}`}
                      onClick={clickable ? () => setExpanded(isOpen ? null : key) : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      role={clickable ? "button" : undefined}
                      aria-expanded={clickable ? isOpen : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setExpanded(isOpen ? null : key);
                              }
                            }
                          : undefined
                      }
                    >
                      {columns.map((col) => (
                        <td key={col.key} className={col.className}>
                          {col.render(row)}
                        </td>
                      ))}
                      {clickable && (
                        <td className="vn-dt__chev">
                          <ChevronDown size={16} aria-hidden="true" className={isOpen ? "is-open" : ""} />
                        </td>
                      )}
                    </tr>
                    {clickable && isOpen && (
                      <tr className="vn-dt__expanded">
                        <td colSpan={colSpan}>{renderExpanded(row)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && total > pageSize && (
        <div className="vn-dt__pager">
          <span className="vn-dt__count">
            {start + 1}–{Math.min(start + pageSize, total)} of {total}
          </span>
          <div className="vn-dt__pager-btns">
            <button
              type="button"
              className="vn-dt__pager-btn"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              aria-label="Previous page"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="vn-dt__page">
              {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="vn-dt__pager-btn"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              aria-label="Next page"
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
