import Head from 'next/head'
import { CubeVaultBackground } from '@/components/cubeVaultBackground'

const CubeVaultBackgroundPage = () => (
  <>
    <Head>
      <title>System Cell Background</title>
    </Head>
    <main className="h-screen w-screen overflow-hidden bg-[#020611]">
      <CubeVaultBackground />
    </main>
  </>
)

export default CubeVaultBackgroundPage
