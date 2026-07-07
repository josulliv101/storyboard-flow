import { redirect } from "next/navigation";

import { DEFAULT_COLLECTION_ID } from "../lib/collections";

export default function Home() {
  redirect(`/collections/${DEFAULT_COLLECTION_ID}`);
}
