// data components (one export line per component)
export { Lines, type LinesProps } from "./Lines";
export { StatRow, type StatRowProps, type Stat, type StatDot } from "./StatRow";
export { KeyValueList, type KeyValueListProps, type KeyValuePair, type KeyValueRow, type HealthRow } from "./KeyValueList";
export { Table, type TableProps, type Column, type ColumnKind, type TableGroup, type RowMark } from "./Table";
export { Movements, type MovementsProps, type Movement, type MovementKind } from "./Movements";
export { Timeline, type TimelineProps, type TimelineItem, type TimelineState } from "./Timeline";
export { StepRail, type StepRailProps, type Step, type StepState } from "./StepRail";
export { PermissionsTable, type PermissionsTableProps, type Ability, type Permission } from "./PermissionsTable";
export { LineChart, niceStep, niceTop, hourTicks, type LineChartProps, type ChartPoint, type ChartBreak } from "./LineChart";
export { BalanceBar, balanceShares, type BalanceBarProps, type BalanceSegment, type BalanceTone } from "./BalanceBar";
export { BalanceChip, type BalanceChipProps } from "./BalanceChip";
export { Checks, checksSummary, type ChecksProps, type Check, type CheckState } from "./Checks";
export { PromiseList, type PromiseListProps, type PromiseLine } from "./PromiseList";
export { Funnel, FunnelRow, funnelPercents, type FunnelProps, type FunnelRowProps, type FunnelStep, type FunnelTone } from "./FunnelRow";
export { SplitBar, splitShares, type SplitBarProps, type SplitPart } from "./SplitBar";
export { Runway, runwayDays, type RunwayProps } from "./Runway";
export { Reach, type ReachProps } from "./Reach";
