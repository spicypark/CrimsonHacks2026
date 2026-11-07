import type { Metadata } from "next";
import { Suspense } from "react";
import { NightPlanner } from "@/components/plan/night-planner";

export const metadata: Metadata = {
  title: "Plan my night — PullUp",
  description: "Describe your night and get a plan built from real events along the Wasatch Front.",
};

export default function PlanPage(props: PageProps<"/plan">) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 sm:px-6">
      <main id="main" className="mt-8 sm:mt-12">
        {/* The empty planner is the static shell; a shared ?q= link swaps in a planner that runs straight away. */}
        <Suspense fallback={<NightPlanner initial="" />}>
          <PlannerFromLink searchParams={props.searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

async function PlannerFromLink({ searchParams }: { searchParams: PageProps<"/plan">["searchParams"] }) {
  const { q } = await searchParams;
  return <NightPlanner initial={typeof q === "string" ? q.slice(0, 600) : ""} />;
}
