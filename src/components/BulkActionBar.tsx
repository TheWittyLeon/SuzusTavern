'use client';
/**
 * BulkActionBar — shared "N selected" toolbar for the dashboard's characters
 * grid and campaigns list (BULK-DEL). Rendered by the caller once at least
 * one row is selected; the caller owns all selection state via useBulkDelete.
 *
 * `role="region"` + a static `aria-label` gives assistive tech a stable
 * landmark name; the live count lives in its own `aria-live="polite"` span so
 * only the count text is announced as selections change, not the whole
 * region's label.
 */
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import styles from './BulkActionBar.module.css';

export interface BulkActionBarProps {
  count: number;
  /** Singular, lowercase noun, e.g. "character" / "campaign". */
  noun: string;
  onSelectAll: () => void;
  onClear: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

export default function BulkActionBar({
  count,
  noun,
  onSelectAll,
  onClear,
  onCancel,
  onDelete,
}: BulkActionBarProps) {
  const plural = `${noun}${count === 1 ? '' : 's'}`;

  return (
    <div role="region" aria-label="Bulk actions" className={styles.bar}>
      <span aria-live="polite" className={styles.count}>
        {count} {plural} selected
      </span>
      <div className={styles.actions}>
        <Button variant="ghost" onClick={onSelectAll}>
          Select all
        </Button>
        <Button variant="ghost" onClick={onClear}>
          Clear
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="danger"
          leadingIcon={<Icon name="Trash" size={14} aria-hidden />}
          onClick={onDelete}
        >
          Delete selected
        </Button>
      </div>
    </div>
  );
}
