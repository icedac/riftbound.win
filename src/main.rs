use anyhow::Result;
use axum::Router;
use clap::{Parser, Subcommand};
use riftbound_sim::local_api::{LocalApiOptions, build_local_api_router};
use riftbound_sim::syncer::{DEFAULT_API_URL, SyncOptions, sync_cards};
use std::net::SocketAddr;
use std::path::PathBuf;
use tower_http::services::ServeDir;

#[derive(Debug, Parser)]
#[command(name = "riftbound-sim")]
#[command(about = "Sync and browse Riftbound cards locally")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    Sync {
        #[arg(long, default_value = DEFAULT_API_URL)]
        api_url: String,
        #[arg(long, default_value = "data/riftbound.sqlite")]
        db: PathBuf,
        #[arg(long, default_value = "public")]
        public_dir: PathBuf,
        #[arg(long, default_value_t = 16)]
        image_concurrency: usize,
    },
    Serve {
        #[arg(long, default_value = "public")]
        public_dir: PathBuf,
        #[arg(long, default_value = "data/riftbound-local.sqlite")]
        db: PathBuf,
        #[arg(long, default_value_t = 5173)]
        port: u16,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Sync {
            api_url,
            db,
            public_dir,
            image_concurrency,
        } => {
            let summary = sync_cards(SyncOptions {
                api_url,
                db_path: db,
                public_dir,
                image_concurrency,
            })
            .await?;
            println!("{}", serde_json::to_string_pretty(&summary)?);
        }
        Commands::Serve {
            public_dir,
            db,
            port,
        } => serve(public_dir, db, port).await?,
    }
    Ok(())
}

async fn serve(public_dir: PathBuf, db: PathBuf, port: u16) -> Result<()> {
    let api = build_local_api_router(LocalApiOptions {
        db_path: db,
        public_dir: public_dir.clone(),
    })?;
    let app = Router::new()
        .merge(api)
        .fallback_service(ServeDir::new(public_dir).append_index_html_on_directories(true));
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("Serving Riftbound viewer at http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}
