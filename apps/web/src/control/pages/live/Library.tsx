// The Library (/:callSign/library, a folder at /library/:folderId, the "needs attention" lists at
// /library/rights and /library/preparing, link imports at /library/links): folders on the left
// (live-listings 04.1), and the items as setup step 2 draws them (master-control A.2), with
// upload and Import from a link. ?rights=:itemId opens "Can BEAT air …?" (A.3). A242 (2026-10-02):
// the closers, off-air cards and openers at /library/closers, /library/off-air-cards and
// /library/openers, each with the sign-off and sign-on sequence, and uploads there marked as one.

import { useParams, useSearchParams } from "react-router";
import { libraryApi, stationsApi, type LibraryCode, type LibraryItem } from "@opencast/contracts";
import { ControlTitle } from "@opencast/ui";
import { useApi } from "../../../api/hooks";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import { FolderRail, GeneratedStationIdRow, IDENT_LISTS, identityCounts, LibrarySummary, LibraryTable, RightsPane, SignOffSequence, UploadDrop } from "../../components/live/LibraryParts";
import { Quiet } from "../common";
import "./Library.css";

const SPECIAL: Record<string, { title: string; keep: (i: LibraryItem) => boolean; empty: string; code?: LibraryCode }> = {
  links: { title: "Imported from links", keep: (i) => i.source === "link", empty: "Nothing imported from a link." },
  rights: { title: "Rights to confirm", keep: (i) => !i.rights, empty: "Every item's rights are confirmed." },
  preparing: { title: "Preparing for air", keep: (i) => i.status === "preparing", empty: "Nothing is being prepared for air." },
  // A242: what airs when the station signs off and back on.
  ...Object.fromEntries(
    IDENT_LISTS.map((l) => [l.key, { title: l.title, code: l.code, keep: (i: LibraryItem) => i.identCode === l.code, empty: `No ${l.one} of your own yet. Until you add one, Opencast makes one in your look.` }])
  )
};

export default function Library() {
  const { folderId = "all" } = useParams();
  const [params, setParams] = useSearchParams();
  const s = useStation();
  const phone = useIsPhone();
  useShellOptions({ flush: true });
  const identityList = IDENT_LISTS.some((l) => l.key === folderId);
  const rule = useApi(stationsApi.getBreakRule, { params: { stationId: s.id } }, { enabled: identityList, retry: false });
  const lib = useApi(
    libraryApi.getLibrary,
    { params: { stationId: s.id }, query: {} },
    { refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === "preparing") ? 2000 : false) }
  );
  if (lib.isLoading) return <Quiet />;
  const callSign = s.label;
  if (lib.isError || !lib.data) {
    return (
      <div className="cc-lib-main">
        <ControlTitle title="Library" />
        <p role="alert">{lib.error?.message}</p>
      </div>
    );
  }
  const data = lib.data;
  const folder = data.folders.find((f) => f.id === folderId);
  const special = SPECIAL[folderId];
  const items = special ? data.items.filter(special.keep) : folder ? data.items.filter((i) => i.folderId === folder.id) : data.items;
  const rightsItem = data.items.find((i) => i.id === params.get("rights")) ?? null;
  const openRights = (id: string) => setParams((p) => (p.set("rights", id), p));
  const closeRights = () => setParams((p) => (p.delete("rights"), p), { replace: true });

  return (
    <div className="cc-libwrap">
      <FolderRail base={s.base} active={folder || special ? folderId : "all"} total={data.items.length} folders={data.folders} importedFromLinks={data.importedFromLinks} needsAttention={data.needsAttention} identity={identityCounts(data.items)} />
      <div className="cc-lib-main">
        <ControlTitle title={special?.title ?? folder?.name ?? "Library"} description={folder || special ? undefined : `Everything ${callSign} can put on air. Each item is prepared for air when it arrives, and each needs its type set and its rights confirmed.`} />
        {identityList && (
          <SignOffSequence
            items={data.items}
            ident={[s.station.channel, s.station.callSign ?? s.station.name].filter(Boolean).join(" ")}
            radio={s.station.band === "radio"}
            stationIdAfterOpener={rule.data?.stationIdAfterOpener}
          />
        )}
        <UploadDrop stationId={s.id} folderId={folder?.id ?? null} code={special?.code} />
        {items.length > 0 && <LibrarySummary items={items} />}
        <LibraryTable
          items={items}
          colour={s.station.colour ?? "#8C3B7A"}
          label={special?.title ?? folder?.name ?? "Library"}
          onRights={(i) => openRights(i.id)}
          hrefFor={(i) => `${s.base}/library/items/${i.id}${folder ? `?folder=${folder.id}` : ""}`}
          empty={special?.empty ?? (folder ? "Nothing in this folder yet." : "The library is empty. Drop files here, or import from a link.")}
        />
        {/* The generated station ID (added 2026-09-29): with all items, read-only. */}
        {!folder && !special && data.generatedStationId && (
          <GeneratedStationIdRow generated={data.generatedStationId} callSign={callSign} colour={s.station.colour ?? "#8C3B7A"} radio={s.station.band === "radio"} phone={phone} />
        )}
      </div>
      <RightsPane item={rightsItem} callSign={callSign} phone={phone} onClose={closeRights} />
    </div>
  );
}
