import React from 'react'
import './globals.css'
import { Inter } from 'next/font/google'
import { ConvexClientProvider } from './ConvexClientProvider'
import { Navigation } from './components/layout/Navigation'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'StaleBot - GitHub Issue Janitor',
  description: 'Monitor repositories for stale issues and send email notifications',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ConvexClientProvider>
          <Navigation />
          {children}
        </ConvexClientProvider>
      </body>
    </html>
  )
}