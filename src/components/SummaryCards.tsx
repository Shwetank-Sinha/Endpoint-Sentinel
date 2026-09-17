import type { DashboardSummary } from "../types/dashboard";

const TONES = ["navy", "healthy", "degraded", "critical", "blue"] as const;
type Tone = (typeof TONES)[number];

interface SummaryCardItem {
	key: string;
	label: string;
	value: number;
	tone: Tone;
}

interface SummaryCardsProps {
	summary: DashboardSummary;
}

export default function SummaryCards({ summary }: SummaryCardsProps) {
	const cards: SummaryCardItem[] = [
		{ key: "total", label: "Total Endpoints", value: summary.total, tone: "navy" },
		{ key: "healthy", label: "Healthy", value: summary.healthy, tone: "healthy" },
		{ key: "degraded", label: "Degraded", value: summary.degraded, tone: "degraded" },
		{ key: "critical", label: "Critical", value: summary.critical, tone: "critical" },
		{ key: "pending", label: "Pending Checks", value: summary.pending, tone: "blue" },
	];

	return (
		<section
			className="es-summary"
			aria-label="Endpoint summary"
			role="status"
			aria-live="polite"
		>
			{cards.map((card) => (
				<div
					key={card.key}
					className={`es-summary-card es-summary-card--${card.tone}`}
				>
					<span className="es-summary-label">{card.label}</span>
					<span className="es-summary-value">{card.value}</span>
				</div>
			))}
		</section>
	);
}