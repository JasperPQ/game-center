import { useRef } from "react";
import envelopeUrl from "./assets/pixel/envelope.png";
import "./letter.css";

/** 站长写给第一次来的朋友的信（原文照录，不改字）。最后两行是落款。 */
const PARAGRAPHS = [
  "我总觉得书应该有扉页，信应该有提头。所以我把这段话写在这里，算作我们第一次见面，第一次打招呼。谢谢你我陌生的朋友，有勇气点击进这个陌生的网址，这里是以我假想友人咕噜嘎为名的桌游集合站点。",
  "网站的初衷很朴素，只是想用agent做一个画面干净的宝石商人（可惜那个版本已经被现在像素风格取缔），能随时随地和其他地方的朋友们玩上一把，后面又陆陆续续增添了一些其他桌游。我没有很多朋友，和他们一起打桌游打牌的时光我倍感珍惜，也许你也一样，和朋友们来到这里怀念当时的下午。",
  "写在这里的文字没有任何llm的润色，但网站内大部分的搭建是opus的作品，如果哪里有问题或是需要什么新功能（甚至是想实现你幻想的游戏）可以随时和管理员沟通。",
  "陌生的朋友，祝你在这里玩的开心。更希望你有一天可以离开这里，和你的朋友们面对面享受一个惬意的下午。",
];
const SIGNATURE = ["23岁于纽约", "---PQ--- （这是一个彩蛋）"];

/** 「你好，桌友。」右边的像素信封，点开是一张信纸。 */
export function Letter() {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button className="letter-envelope" type="button" aria-label="打开信" onClick={() => dialog.current?.showModal()}>
        <img src={envelopeUrl} alt="" width={50} height={34} />
      </button>
      <dialog
        ref={dialog}
        className="letter-dialog"
        aria-label="写给你的信"
        // 点信纸外面的暗处也能收起来
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
      >
        <div className="letter-paper">
          {/* 段落用 div 不用 p：信纸在 .account-heading 里，那里给 p 设了字号和颜色（白天版还另有一份） */}
          <div className="letter-body">
            {PARAGRAPHS.map((text) => <div className="letter-paragraph" key={text}>{text}</div>)}
            <div className="letter-signature">
              {SIGNATURE[0]}<br />{SIGNATURE[1]}
            </div>
          </div>
          <form method="dialog" className="letter-actions">
            <button className="quiet-button" type="submit">收好信</button>
          </form>
        </div>
      </dialog>
    </>
  );
}
