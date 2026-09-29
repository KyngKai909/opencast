// The Library (/:callSign/library, a folder at /library/:folderId, the "needs attention" lists at
// /library/rights and /library/preparing, link imports at /library/links): folders on the left
// (live-listings 04.1), and the items as setup step 2 draws them (master-control A.2), with
// upload and Import from a link. ?rights=:itemId opens "Can BEAT air …?" (A.3).

import { useParams, useSearchParams } from "react-router";
import { libraryApi } from "@opencast/contracts";
import { ControlTitle } from "@opencast/ui";
import { useApi } from "../../../api/hooks";
import { LibraryExt, type LibraryItemExt } from "../../api/ext/live";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { useStation } from "../../station/StationContext";
import { FolderRail, LibrarySummary, LibraryTable, RightsPane, UploadDrop } from "../../components/live/LibraryParts";
import { Quiet } from "../common";
import "./Library.css";

const SPECIAL: Record<string, { title: string; keep: (i: LibraryItemExt) => boolean; empty: string }> = {
  links: { title: "Imported from links", keep: (i) => i.source === "link", empty: "Nothing imported from a link." },
  rights: { title: "Rights to confirm", keep: (i) => !i.rights, empty: "Every item's rights are confirmed." },
  preparing: { title: "Preparing for air", keep: (i) => i.status === "preparing", empty: "Nothing is being prepared for air." }
};

export default function Library() {
  const { folderId = "all" } = useParams();
  const [params, setParams] = useSearchParams();
  const s = useStation();
  const phone = useIsPhone();
  useShellOptions({ flush: true });
  const lib = useApi(
    libraryApi.getLibrary,
    { params: { stationId: s.id }, query: {} },
    { schema: LibraryExt, refetchInterval: (q) => (q.state.data?.items.some((i) => i.status === "preparing") ? 2000 : false) }
  );
  if (lib.isLoading) return <Quiet />;
  const callSign = s.station.callSign ?? s.station.name;
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
      <FolderRail base={s.base} active={folder || special ? folderId : "all"} total={data.items.length} folders={data.folders} importedFromLinks={data.importedFromLinks} needsAttention={data.needsAttention} />
      <div className="cc-lib-main">
        <ControlTitle title={special?.title ?? folder?.name ?? "Library"} description={folder || special ? undefined : `Everything ${callSign} can put on air. Each item is prepared for air when it arrives, and each needs its type set and its rights confirmed.`} />
        <UploadDrop stationId={s.id} folderId={folder?.id ?? null} />
        {items.length > 0 && <LibrarySummary items={items} />}
        <LibraryTable
          items={items}
          colour={s.station.colour ?? "#8C3B7A"}
          label={special?.title ?? folder?.name ?? "Library"}
          onRights={(i) => openRights(i.id)}
          hrefFor={(i) => `${s.base}/library/items/${i.id}${folder ? `?folder=${folder.id}` : ""}`}
          empty={special?.empty ?? (folder ? "Nothing in this folder yet." : "The library is empty. Drop files here, or import from a link.")}
        />
      </div>
      <RightsPane item={rightsItem} callSign={callSign} phone={phone} onClose={closeRights} />
    </div>
  );
}
