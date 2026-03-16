import Marquee from "react-fast-marquee";
import { ExternalLink } from "lucide-react";

const NewsTicker = ({ news }) => {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-zinc-950 border-t border-zinc-800 py-2 z-50" data-testid="news-ticker">
      <Marquee speed={40} gradient={false}>
        <div className="flex items-center gap-8 px-4">
          {news.map((article, index) => (
            <a
              key={index}
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 hover:text-red-400 transition-colors"
              data-testid={`news-item-${index}`}
            >
              <span className="text-red-500 font-mono text-xs uppercase tracking-widest">
                [{article.source}]
              </span>
              <span className="text-zinc-300 font-mono text-xs">{article.title}</span>
              <ExternalLink className="w-3 h-3 text-zinc-500" />
            </a>
          ))}
        </div>
      </Marquee>
    </div>
  );
};

export default NewsTicker;