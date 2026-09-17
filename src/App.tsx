import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AddEndpointModal from "./components/AddEndpointModal";
import EndpointCard from "./components/EndpointCard";
import HistoryModal from "./components/HistoryModal";
import SummaryCards from "./components/SummaryCards";
import { createDefaultTarget, runRealtimeCheck } from "./services/monitoringApi";
import {
	appendHistoryEntry,
	loadSavedEndpoints,
	loadSavedHistory,
	saveEndpoints,
	saveHistory,
} from "./services/storage";
import type {
	DashboardEndpoint,
	DashboardSummary,
	EndpointHistoryMap,
	HistoryEntry,
} from "./types/dashboard";
import type { CheckTarget } from "./types/monitoring";

interface EndpointDefinition {
	id: string;
	name: string;
	target: CheckTarget;
}

const DEMO_ENDPOINTS: readonly EndpointDefinition[] = [
	{
		id: "endpoint-healthy",
		name: "API Health",
		target: { ...createDefaultTarget(), url: "/api/demo/healthy" },
	},
	{
		id: "endpoint-slow",
		name: "Slow Endpoint",
		target: { ...createDefaultTarget(), url: "/api/demo/slow" },
	},
	{
		id: "endpoint-failing",
		name: "Failing Endpoint",
		target: { ...createDefaultTarget(), url: "/api/demo/failing" },
	},
];

function toDashboardEndpoint(def: EndpointDefinition): DashboardEndpoint {
	return { ...def, status: "NOT_CHECKED", result: null, error: null };
}

const INITIAL_ENDPOINTS: DashboardEndpoint[] = DEMO_ENDPOINTS.map(toDashboardEndpoint);

function toMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Unknown error";
}

const CHECK_ALL_CONCURRENCY = 4;

/**
 * Runs checks for `ids` with at most `concurrency` in-flight at once.
 * Each worker pulls the next id from the queue, so results stream in as
 * checks finish. Errors are contained per-item (runCheck reports failures
 * back into state) and the batch always settles, so one failed endpoint
 * can never prevent the remaining checks from running.
 */
async function runChecksConcurrently(
	ids: readonly string[],
	runCheck: (id: string) => Promise<void>,
	concurrency: number,
): Promise<void> {
	const queue = [...ids];
	const workerCount = Math.max(1, Math.min(concurrency, queue.length));
	await Promise.allSettled(
		Array.from({ length: workerCount }, async () => {
			while (queue.length > 0) {
				const id = queue.shift();
				if (id === undefined) break;
				await runCheck(id);
			}
		}),
	);
}

export default function App() {
	const [endpoints, setEndpoints] = useState<DashboardEndpoint[]>(
		() => loadSavedEndpoints() ?? INITIAL_ENDPOINTS,
	);
	const [history, setHistory] = useState<EndpointHistoryMap>(() => loadSavedHistory());
	const [addModalOpen, setAddModalOpen] = useState(false);
	const [historyEndpointId, setHistoryEndpointId] = useState<string | null>(null);
	const autoChecked = useRef(false);

	useEffect(() => {
		saveEndpoints(endpoints);
	}, [endpoints]);

	useEffect(() => {
		saveHistory(history);
	}, [history]);

	const patchEndpoint = useCallback((id: string, patch: Partial<DashboardEndpoint>) => {
		setEndpoints((prev) =>
			prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
		);
	}, []);

	const checkEndpoint = useCallback(
		async (id: string) => {
			const def = endpoints.find((entry) => entry.id === id);
			if (!def) return;

			patchEndpoint(id, { status: "CHECKING", result: null, error: null });

			let entry: HistoryEntry;
			try {
				const result = await runRealtimeCheck(def.target);
				patchEndpoint(id, { status: result.status, result });
				entry = {
					status: result.status,
					result,
					error: null,
					checkedAt: result.checkedAt,
				};
			} catch (caught) {
				const message = toMessage(caught);
				patchEndpoint(id, { status: "ERROR", error: message });
				entry = {
					status: "ERROR",
					result: null,
					error: message,
					checkedAt: new Date().toISOString(),
				};
			}

			setHistory((prev) => appendHistoryEntry(prev, id, entry));
		},
		[endpoints, patchEndpoint],
	);

	const checkAll = useCallback(() => {
		void runChecksConcurrently(
			endpoints.map((def) => def.id),
			checkEndpoint,
			CHECK_ALL_CONCURRENCY,
		);
	}, [checkEndpoint, endpoints]);

	useEffect(() => {
		if (autoChecked.current) return;
		autoChecked.current = true;
		checkAll();
	}, [checkAll]);

	const addEndpoint = useCallback((name: string, target: CheckTarget) => {
		const id = crypto.randomUUID();
		setEndpoints((prev) => [
			...prev,
			{ id, name, target, status: "NOT_CHECKED", result: null, error: null },
		]);
		setAddModalOpen(false);
	}, []);

	const restoreDemoEndpoints = useCallback(() => {
		const confirmed = window.confirm(
			"Replace the current endpoint list with the demo endpoints? Custom endpoints and their history will be removed.",
		);
		if (!confirmed) return;
		setEndpoints(INITIAL_ENDPOINTS);
		setHistory({});
	}, []);

	const summary = useMemo<DashboardSummary>(() => {
		let healthy = 0;
		let degraded = 0;
		let critical = 0;
		let pending = 0;

		for (const endpoint of endpoints) {
			switch (endpoint.status) {
				case "HEALTHY":
					healthy += 1;
					break;
				case "DEGRADED":
					degraded += 1;
					break;
				case "CRITICAL":
				case "ERROR":
					critical += 1;
					break;
				case "NOT_CHECKED":
				case "CHECKING":
					pending += 1;
					break;
			}
		}

		return {
			total: endpoints.length,
			healthy,
			degraded,
			critical,
			pending,
		};
	}, [endpoints]);

	const anyChecking = endpoints.some((endpoint) => endpoint.status === "CHECKING");

	const historyEndpoint = useMemo(
		() => endpoints.find((entry) => entry.id === historyEndpointId) ?? null,
		[endpoints, historyEndpointId],
	);
	const historyEntries = historyEndpoint
		? (history[historyEndpoint.id] ?? [])
		: [];

	return (
		<main className="es-app">
			<header className="es-hero">
				<div>
					<h1 className="es-title">Endpoint Sentinel</h1>
					<p className="es-subtitle">Realtime health checks for your monitored endpoints.</p>
				</div>
				<div className="es-hero__actions">
					<button type="button" className="es-btn" onClick={restoreDemoEndpoints}>
						Restore Demo Endpoints
					</button>
					<button type="button" className="es-btn" onClick={() => setAddModalOpen(true)}>
						Add Endpoint
					</button>
					<button
						type="button"
						className="es-btn es-btn--primary"
						onClick={checkAll}
						disabled={anyChecking}
						aria-live="polite"
					>
						{anyChecking ? "Checking All…" : "Check All"}
					</button>
				</div>
			</header>

			<SummaryCards summary={summary} />

			<section
				className="es-grid"
				aria-label="Monitored endpoints"
				aria-busy={anyChecking}
			>
				{endpoints.map((endpoint) => (
					<EndpointCard
						key={endpoint.id}
						endpoint={endpoint}
						onCheck={checkEndpoint}
						onShowHistory={setHistoryEndpointId}
					/>
				))}
			</section>

			{addModalOpen ? (
				<AddEndpointModal onClose={() => setAddModalOpen(false)} onAdd={addEndpoint} />
			) : null}

			{historyEndpoint ? (
				<HistoryModal
					endpoint={historyEndpoint}
					history={historyEntries}
					onClose={() => setHistoryEndpointId(null)}
				/>
			) : null}
		</main>
	);
}