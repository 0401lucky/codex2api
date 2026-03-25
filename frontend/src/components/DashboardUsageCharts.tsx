import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import StateShell from './StateShell'
import type { UsageLog } from '../types'

interface DashboardUsageChartsProps {
  logs: UsageLog[]
}

interface TimelinePoint {
  label: string
  fullLabel: string
  requests: number
  avgLatency: number | null
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cachedTokens: number
}

interface ModelRankingPoint {
  model: string
  shortModel: string
  requests: number
  totalTokens: number
}

const chartMargin = { top: 8, right: 12, left: -12, bottom: 0 }
const gridColor = 'hsl(var(--border))'
const axisColor = 'hsl(var(--muted-foreground))'
const tooltipContentStyle = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '16px',
  boxShadow: '0 18px 40px rgba(0, 0, 0, 0.12)',
}
const tooltipLabelStyle = { color: 'hsl(var(--foreground))', fontWeight: 600 }
const tooltipItemStyle = { color: 'hsl(var(--foreground))' }
const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export default function DashboardUsageCharts({ logs }: DashboardUsageChartsProps) {
  const { t } = useTranslation()

  const chartData = useMemo(() => {
    const parsedLogs = logs
      .map((log) => {
        const createdAt = parseUsageDate(log.created_at)
        if (!createdAt) return null
        return { ...log, createdAt }
      })
      .filter((log): log is UsageLog & { createdAt: Date } => Boolean(log))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    if (parsedLogs.length === 0) {
      return {
        timelineData: [] as TimelinePoint[],
        modelData: [] as ModelRankingPoint[],
        sampleCount: 0,
      }
    }

    const latestBucketEnd = new Date(parsedLogs[parsedLogs.length - 1].createdAt)
    latestBucketEnd.setMinutes(0, 0, 0)
    latestBucketEnd.setHours(latestBucketEnd.getHours() + 1)

    const bucketMs = 60 * 60 * 1000
    const bucketCount = 24
    const windowStart = latestBucketEnd.getTime() - bucketCount * bucketMs

    const timelineData: TimelinePoint[] = Array.from({ length: bucketCount }, (_, index) => {
      const bucketDate = new Date(windowStart + index * bucketMs)
      return {
        label: formatHourLabel(bucketDate),
        fullLabel: formatFullHourLabel(bucketDate),
        requests: 0,
        avgLatency: null,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedTokens: 0,
      }
    })

    const latencyTotals = Array.from({ length: bucketCount }, () => 0)
    const latencySamples = Array.from({ length: bucketCount }, () => 0)
    const windowLogs: Array<UsageLog & { createdAt: Date }> = []

    for (const log of parsedLogs) {
      const timestamp = log.createdAt.getTime()
      if (timestamp < windowStart || timestamp >= latestBucketEnd.getTime()) continue

      const bucketIndex = Math.min(bucketCount - 1, Math.floor((timestamp - windowStart) / bucketMs))
      const bucket = timelineData[bucketIndex]

      bucket.requests += 1
      bucket.inputTokens += Math.max(log.input_tokens, 0)
      bucket.outputTokens += Math.max(log.output_tokens, 0)
      bucket.reasoningTokens += Math.max(log.reasoning_tokens, 0)
      bucket.cachedTokens += Math.max(log.cached_tokens, 0)

      if (log.duration_ms > 0) {
        latencyTotals[bucketIndex] += log.duration_ms
        latencySamples[bucketIndex] += 1
      }

      windowLogs.push(log)
    }

    for (let index = 0; index < bucketCount; index += 1) {
      if (latencySamples[index] > 0) {
        timelineData[index].avgLatency = Math.round(latencyTotals[index] / latencySamples[index])
      }
    }

    const modelRankingMap = new Map<string, { requests: number; totalTokens: number }>()

    for (const log of windowLogs) {
      const model = log.model.trim() || t('dashboard.unknownModel')
      const current = modelRankingMap.get(model) ?? { requests: 0, totalTokens: 0 }
      current.requests += 1
      current.totalTokens += Math.max(log.total_tokens, 0)
      modelRankingMap.set(model, current)
    }

    const modelData = Array.from(modelRankingMap.entries())
      .map(([model, value]) => ({
        model,
        shortModel: truncateLabel(model, 22),
        requests: value.requests,
        totalTokens: value.totalTokens,
      }))
      .sort((left, right) => right.requests - left.requests || right.totalTokens - left.totalTokens)
      .slice(0, 5)
      .reverse()

    return {
      timelineData,
      modelData,
      sampleCount: windowLogs.length,
    }
  }, [logs, t])

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">{t('dashboard.usageCharts')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('dashboard.usageChartsDesc', { count: chartData.sampleCount.toLocaleString() })}</p>
      </div>

      {chartData.timelineData.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <StateShell
              variant="section"
              isEmpty
              emptyTitle={t('dashboard.chartsEmptyTitle')}
              emptyDescription={t('dashboard.chartsEmptyDesc')}
            >
              <></>
            </StateShell>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartCard title={t('dashboard.requestTrend')} description={t('dashboard.requestTrendDesc')}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData.timelineData} margin={chartMargin}>
                <defs>
                  <linearGradient id="dashboard-request-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={gridColor} strokeDasharray="4 4" />
                <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 12 }} axisLine={{ stroke: gridColor }} tickLine={{ stroke: gridColor }} />
                <YAxis tickFormatter={formatCompactNumber} tick={{ fill: axisColor, fontSize: 12 }} axisLine={{ stroke: gridColor }} tickLine={{ stroke: gridColor }} allowDecimals={false} />
                <Tooltip
                  formatter={(value) => formatNumber(value)}
                  labelFormatter={(_, payload) => getTooltipLabel(payload, 'fullLabel')}
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                />
                <Area
                  type="monotone"
                  dataKey="requests"
                  name={t('dashboard.seriesRequests')}
                  stroke="hsl(var(--primary))"
                  fill="url(#dashboard-request-gradient)"
                  strokeWidth={2.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={t('dashboard.latencyTrend')} description={t('dashboard.latencyTrendDesc')}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData.timelineData} margin={chartMargin}>
                <CartesianGrid vertical={false} stroke={gridColor} strokeDasharray="4 4" />
                <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 12 }} axisLine={{ stroke: gridColor }} tickLine={{ stroke: gridColor }} />
                <YAxis tickFormatter={formatDurationTick} tick={{ fill: axisColor, fontSize: 12 }} axisLine={{ stroke: gridColor }} tickLine={{ stroke: gridColor }} width={54} />
                <Tooltip
                  formatter={(value) => formatDuration(value)}
                  labelFormatter={(_, payload) => getTooltipLabel(payload, 'fullLabel')}
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                />
                <Line
                  type="monotone"
                  dataKey="avgLatency"
                  name={t('dashboard.seriesAvgLatency')}
                  stroke="hsl(var(--info))"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={t('dashboard.tokenBreakdown')} description={t('dashboard.tokenBreakdownDesc')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData.timelineData} margin={chartMargin}>
                <CartesianGrid vertical={false} stroke={gridColor} strokeDasharray="4 4" />
                <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 12 }} axisLine={{ stroke: gridColor }} tickLine={{ stroke: gridColor }} />
                <YAxis tickFormatter={formatCompactNumber} tick={{ fill: axisColor, fontSize: 12 }} axisLine={{ stroke: gridColor }} tickLine={{ stroke: gridColor }} />
                <Tooltip
                  formatter={(value) => formatNumber(value)}
                  labelFormatter={(_, payload) => getTooltipLabel(payload, 'fullLabel')}
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                />
                <Legend wrapperStyle={{ paddingTop: 12, fontSize: 12 }} />
                <Bar dataKey="inputTokens" stackId="tokens" name={t('dashboard.seriesInputTokens')} fill="hsl(var(--info))" radius={[0, 0, 4, 4]} />
                <Bar dataKey="outputTokens" stackId="tokens" name={t('dashboard.seriesOutputTokens')} fill="hsl(var(--success))" />
                <Bar dataKey="reasoningTokens" stackId="tokens" name={t('dashboard.seriesReasoningTokens')} fill="hsl(36 90% 55%)" />
                <Bar dataKey="cachedTokens" stackId="tokens" name={t('dashboard.seriesCachedTokens')} fill="hsl(262 83% 58%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={t('dashboard.modelRanking')} description={t('dashboard.modelRankingDesc')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData.modelData} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke={gridColor} strokeDasharray="4 4" />
                <XAxis type="number" tickFormatter={formatCompactNumber} tick={{ fill: axisColor, fontSize: 12 }} axisLine={{ stroke: gridColor }} tickLine={{ stroke: gridColor }} allowDecimals={false} />
                <YAxis dataKey="shortModel" type="category" width={128} tick={{ fill: axisColor, fontSize: 12 }} axisLine={{ stroke: gridColor }} tickLine={{ stroke: gridColor }} />
                <Tooltip
                  formatter={(value) => formatNumber(value)}
                  labelFormatter={(_, payload) => getTooltipLabel(payload, 'model')}
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  itemStyle={tooltipItemStyle}
                />
                <Bar dataKey="requests" name={t('dashboard.seriesRequestCount')} fill="hsl(var(--success))" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </div>
  )
}

function ChartCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card className="py-0">
      <CardContent className="p-6">
        <div className="mb-5">
          <h4 className="text-base font-semibold text-foreground">{title}</h4>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <div className="h-[280px]">{children}</div>
      </CardContent>
    </Card>
  )
}

function parseUsageDate(value: string): Date | null {
  const normalizedValue = value.replace(/(Z|[+-]\d{2}(:\d{2})?)$/, '')
  const parsed = new Date(normalizedValue)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function formatHourLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:00`
}

function formatFullHourLabel(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  return `${month}-${day} ${hour}:00`
}

function truncateLabel(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

function formatCompactNumber(value: number | string): string {
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) return '0'
  return compactNumberFormatter.format(numericValue)
}

function formatNumber(value: unknown): string {
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) return '0'
  return numericValue.toLocaleString()
}

function formatDuration(value: unknown): string {
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue) || numericValue <= 0) return '-'
  if (numericValue >= 1000) {
    return `${(numericValue / 1000).toFixed(numericValue >= 10000 ? 0 : 1)}s`
  }
  return `${Math.round(numericValue)}ms`
}

function formatDurationTick(value: number | string): string {
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) return '0ms'
  return formatDuration(numericValue)
}

function getTooltipLabel(payload: readonly { payload?: Record<string, unknown> }[] | undefined, key: string): string {
  const tooltipPayload = payload?.[0]?.payload
  const rawValue = tooltipPayload?.[key]
  return typeof rawValue === 'string' && rawValue ? rawValue : ''
}
