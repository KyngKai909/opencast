import type { CSSProperties, ReactNode } from "react";
import { cx } from "../lib/cx";

/** true reads "Yes" (bold), false "No" (quiet); a string is a partial answer, read quiet ("See only"). */
export type Permission = boolean | string;

export interface Ability {
  /** What the role can do ("Spot market and rotations"). */
  label: ReactNode;
  /** One answer per role, in the order of `roles`. */
  can: Permission[];
}

export interface PermissionsTableProps {
  /** The column heads: "Owner", "Operator", "Host". */
  roles: string[];
  abilities: Ability[];
  /** Each role column's width in px: 90 in station settings, 110 in the business. */
  columnWidth?: number;
  /** The table's accessible name; the page's section heading says it on screen ("What each role can do"). */
  caption: string;
  className?: string;
}

/**
 * What each role can do (station and business settings): roles as columns, abilities as rows,
 * answered in words, "Yes" in bold and "No" or a partial answer quieter. Never colour alone.
 */
export function PermissionsTable({ roles, abilities, columnWidth = 90, caption, className }: PermissionsTableProps) {
  const style = { "--oc-perm-col": `${columnWidth}px` } as CSSProperties;
  return (
    <table className={cx("oc-perm", className)} style={style}>
      <caption className="oc-sr-only">{caption}</caption>
      <thead>
        <tr>
          <td />
          {roles.map((r) => (
            <th key={r} scope="col">
              {r}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {abilities.map((a, i) => (
          <tr key={i}>
            <th scope="row" className="oc-perm__ability">
              {a.label}
            </th>
            {roles.map((r, j) => {
              const p = a.can[j] ?? false;
              return (
                <td key={r} className={p === true ? "oc-perm__yes" : "oc-perm__no"}>
                  {p === true ? "Yes" : p === false ? "No" : p}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
