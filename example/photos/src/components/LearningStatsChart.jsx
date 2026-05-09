import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const EMPTY = [
  { label: '—', files: 0 },
  { label: '—', files: 0 },
  { label: '—', files: 0 },
  { label: '—', files: 0 },
  { label: '—', files: 0 },
  { label: '—', files: 0 },
  { label: '—', files: 0 },
];

export function LearningStatsChart({ data, loading }) {
  const chartData = Array.isArray(data) && data.length > 0 ? data : EMPTY;

  return (
    <div className="h-[168px] w-full">
      {loading ? (
        <div className="flex h-full items-center justify-center rounded-xl bg-white/[0.03] text-xs text-slate-500">
          Scanning /photos via API…
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 8, right: 8, left: -24, bottom: 0 }}
          >
            <defs>
              <linearGradient id="vaultGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.45} />
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tick={{ fill: '#64748b', fontSize: 9 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis hide domain={[0, 'auto']} />
            <Tooltip
              formatter={(value) => [`${value}`, 'Value']}
              labelFormatter={(label) => label}
              contentStyle={{
                backgroundColor: '#1D1F2B',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '10px',
                fontSize: '12px',
                color: '#fff',
              }}
              labelStyle={{ color: '#94a3b8' }}
            />
            <Area
              type="monotone"
              dataKey="files"
              stroke="#3B82F6"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#vaultGradient)"
              dot={{ fill: '#3B82F6', strokeWidth: 0, r: 3 }}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
