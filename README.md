Vorliq
=======

![Vorliq Logo](https://raw.githubusercontent.com/vorliq/Vorliq/main/frontend/public/logo.png)

[![Vorliq CI](https://github.com/vorliq/Vorliq/actions/workflows/ci.yml/badge.svg)](https://github.com/vorliq/Vorliq/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Coin: VLQ](https://img.shields.io/badge/coin-VLQ-6c63ff.svg)

Live website: https://vorliq.github.io/Vorliq

What is Vorliq
--------------

Vorliq is a self contained community savings bank built on its own lightweight blockchain. The native coin inside the application is called VLQ. Vorliq is designed for real communities that want to save money together, lend money together, and keep a trusted shared record without depending on Ethereum, Bitcoin, Solana, or any other outside cryptocurrency network.

How to Run Vorliq
-----------------

Vorliq needs Node.js, Python 3.12, and Git installed on your Windows machine. After the project is downloaded, double click `start.bat` in the root folder to launch the full application. The script opens the Python blockchain API, the Node.js backend API, and the React frontend in separate terminal windows. When the services are running, open your browser to `http://localhost:3000`.

How Vorliq Works
----------------

The blockchain core is written in Python and manages blocks, transactions, wallets, signatures, proof of work, mining rewards, pending transactions, and chain validation. The backend API is written in Node.js with Express and connects the React frontend to the Python blockchain API. The React frontend is the browser application where users can create wallets, check balances, send signed VLQ transactions, inspect the chain, and mine new blocks.

The VLQ Coin
------------

VLQ is the native coin of Vorliq. Miners earn 50 VLQ for every block they mine, and that reward is added to the next block as a system transaction. Normal transactions are signed with real cryptographic keys using the SECP256K1 elliptic curve, and the blockchain verifies those signatures before accepting transactions into the pending pool.

Community
---------

Vorliq on Discord is available at https://discord.gg/qpX5sHD4pC.

Vorliq on Telegram is available at https://t.me/Vorliq.

Vorliq on Reddit is available at https://www.reddit.com/u/Vorliq/s/PbPMGkrGVS.

Vorliq on GitHub is available at https://github.com/vorliq/Vorliq.

Vorliq on X is available at https://x.com/vorliq.
