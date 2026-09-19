import { useEffect, useState } from "react";
import { endpointInitial, endpointPresentation } from "../services/endpointPresentation";

interface Props { name: string; url: string; method: string }

export default function EndpointIdentity({ name, url, method }: Props) {
	const presentation = endpointPresentation(url);
	const [imageState, setImageState] = useState<"loading" | "loaded" | "failed">(presentation.faviconUrl ? "loading" : "failed");
	useEffect(() => { setImageState(presentation.faviconUrl ? "loading" : "failed"); }, [presentation.faviconUrl]);
	const label = presentation.hostname ? `${name} website icon` : `${name} endpoint icon`;
	return <div className="es-endpoint-identity">
		<span className="es-endpoint-icon" role="img" aria-label={label}>
			<span className="es-endpoint-icon__fallback" aria-hidden="true">{endpointInitial(name, presentation.hostname)}</span>
			{presentation.faviconUrl && imageState !== "failed" ? <img className={`es-endpoint-icon__image${imageState === "loaded" ? " es-endpoint-icon__image--loaded" : ""}`} src={presentation.faviconUrl} alt="" aria-hidden="true" onLoad={() => setImageState("loaded")} onError={() => setImageState("failed")} referrerPolicy="no-referrer" /> : null}
		</span>
		<div className="es-card__heading"><h3 className="es-card__name">{name}</h3><div className="es-card__url"><span className="es-card__method">{method}</span>{presentation.protocol ? <span className={`es-card__protocol es-card__protocol--${presentation.protocol.toLowerCase()}`}>{presentation.protocol}</span> : null}{presentation.href ? <a className="es-card__url-link" href={presentation.href} target="_blank" rel="noopener noreferrer" title={presentation.displayUrl} aria-label={`Open ${name} endpoint: ${presentation.displayUrl}`}><code className="es-card__code">{presentation.displayUrl}</code></a> : <code className="es-card__code" title={presentation.displayUrl}>{presentation.displayUrl}</code>}</div></div>
	</div>;
}
