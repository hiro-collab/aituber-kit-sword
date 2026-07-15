import Head from 'next/head'
import { BodyMapInspector } from '@/components/bodyMapInspector'

const BodyMapInspectorPage = () => (
  <>
    <Head>
      <title>Body Map Inspector</title>
    </Head>
    <main className="h-screen w-screen overflow-hidden bg-[#020611]">
      <BodyMapInspector />
    </main>
  </>
)

export default BodyMapInspectorPage
